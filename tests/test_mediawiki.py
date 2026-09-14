import unittest
from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError

from kpop_scraping.mediawiki import MediaWikiClient, MediaWikiError, parse_retry_after


class Response(BytesIO):
    def __init__(self, content, headers=None):
        super().__init__(content)
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def http_error(code, headers=None):
    return HTTPError("https://example.test/api", code, "error", headers or {}, None)


class MediaWikiClientTest(unittest.TestCase):
    @patch.object(MediaWikiClient, "_get")
    def test_category_pagination_uses_continue_token(self, get):
        get.side_effect = [
            {"query": {"categorymembers": [{"pageid": 1}]}, "continue": {"cmcontinue": "next", "continue": "-||"}},
            {"query": {"categorymembers": [{"pageid": 2}]}},
        ]
        members = list(MediaWikiClient().iter_category_members("Category:Test"))
        self.assertEqual([member["pageid"] for member in members], [1, 2])
        self.assertEqual(get.call_args_list[1].args[0]["cmcontinue"], "next")

    @patch.object(MediaWikiClient, "_get")
    def test_get_pages_maps_revision_and_source_fields(self, get):
        get.return_value = {"query": {"pages": [{"pageid": 1, "title": "A", "canonicalurl": "https://example.test/A", "extract": " Intro text. ", "revisions": [{"revid": 42}], "pageprops": {"wikibase_item": "Q1", "disambiguation": ""}}]}}
        page = MediaWikiClient().get_pages([1])[0]
        self.assertEqual(page.revision_id, 42)
        self.assertEqual(page.extract, "Intro text.")
        self.assertEqual(page.wikidata_id, "Q1")
        self.assertTrue(page.is_disambiguation)
        self.assertNotIn("pageprops", page.source_payload)
        self.assertEqual(get.call_args.args[0]["exlimit"], 1)
        self.assertIn("pageprops", get.call_args.args[0]["prop"])

    @patch.object(MediaWikiClient, "_get")
    def test_get_pages_maps_missing_and_redirect_flags(self, get):
        get.return_value = {
            "query": {
                "pages": [
                    {"pageid": 1, "title": "Redirect", "redirect": True},
                    {"pageid": 2, "title": "Deleted", "missing": True},
                ]
            }
        }
        redirect, missing = MediaWikiClient().get_pages([1, 2])
        self.assertTrue(redirect.is_redirect)
        self.assertTrue(missing.is_missing)
        self.assertEqual(missing.canonical_url, "")

    def test_get_pages_rejects_more_than_twenty_extracts(self):
        with self.assertRaisesRegex(ValueError, "at most 20"):
            MediaWikiClient().get_pages(range(21))

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.mediawiki.urlopen")
    def test_retries_maxlag_response(self, urlopen, sleep):
        urlopen.side_effect = [
            Response(b'{"error":{"code":"maxlag","info":"waiting"}}'),
            Response(b'{"query":{"categorymembers":[]}}'),
        ]
        payload = MediaWikiClient(retries=1)._get({"action": "query"})
        self.assertEqual(payload["query"]["categorymembers"], [])
        sleep.assert_called_once_with(1)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.mediawiki.urlopen")
    def test_maxlag_wait_respects_retry_after_header(self, urlopen, sleep):
        urlopen.side_effect = [
            Response(b'{"error":{"code":"maxlag","info":"lag"}}', {"Retry-After": "5"}),
            Response(b'{"entities":{}}'),
        ]
        MediaWikiClient(retries=1)._get({"action": "wbgetentities"})
        sleep.assert_called_once_with(5.0)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.mediawiki.urlopen")
    def test_retries_429_and_5xx_with_backoff(self, urlopen, sleep):
        urlopen.side_effect = [
            http_error(429, {"Retry-After": "3"}),
            http_error(503),
            Response(b'{"entities":{}}'),
        ]
        payload = MediaWikiClient(retries=2)._get({"action": "wbgetentities"})
        self.assertEqual(payload, {"entities": {}})
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [3.0, 2.0])
        request = urlopen.call_args.args[0]
        self.assertIn("maxlag=5", request.full_url)
        self.assertTrue(request.get_header("User-agent").startswith("kpop-quiz/"))
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 30)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.mediawiki.urlopen")
    def test_client_error_is_not_retried(self, urlopen, sleep):
        urlopen.side_effect = [http_error(404)]
        with self.assertRaisesRegex(MediaWikiError, "HTTP 404"):
            MediaWikiClient(retries=3)._get({"action": "query"})
        sleep.assert_not_called()

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.mediawiki.urlopen")
    def test_retry_after_above_limit_stops_without_waiting(self, urlopen, sleep):
        urlopen.side_effect = [http_error(429, {"Retry-After": "3600"})]
        with self.assertRaisesRegex(MediaWikiError, "above the 120s limit"):
            MediaWikiClient(retries=3)._get({"action": "query"})
        sleep.assert_not_called()

    def test_parses_retry_after_date(self):
        now = datetime(2026, 9, 12, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(parse_retry_after("Sat, 12 Sep 2026 12:00:10 GMT", now), 10.0)
        self.assertEqual(parse_retry_after("7"), 7.0)
        self.assertIsNone(parse_retry_after("７"))
        self.assertIsNone(parse_retry_after("soon"))

    @patch.object(MediaWikiClient, "_get", return_value={"query": {}})
    def test_rejects_incomplete_category_response(self, _get):
        with self.assertRaisesRegex(Exception, "unexpected shape"):
            list(MediaWikiClient().iter_category_members("Category:Test"))
