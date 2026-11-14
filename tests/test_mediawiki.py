import json
import ssl
import unittest
from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from kpop_scraping.mediawiki import (
    DEFAULT_MAXLAG_BUDGET_SECONDS,
    MAX_EXTRACT_BYTES,
    MaxlagBudget,
    MediaWikiClient,
    MediaWikiError,
    Page,
    parse_retry_after,
)


class Response(BytesIO):
    def __init__(self, content, headers=None):
        super().__init__(content)
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class FailingResponse(Response):
    """A response whose body fails to arrive, as a dropped TLS session does."""

    def __init__(self, error):
        super().__init__(b"")
        self.error = error

    def read(self, *_args):
        raise self.error


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

    @patch.object(MediaWikiClient, "_get")
    def test_get_revision_wikitext_maps_revisions_and_skips_hidden_content(self, get):
        get.return_value = {"query": {"pages": [
            {"pageid": 1, "revisions": [{"revid": 10, "slots": {"main": {"contentmodel": "wikitext", "content": "{{Infobox}}"}}}]},
            {"pageid": 2, "revisions": [{"revid": 20, "slots": {"main": {"texthidden": True}}}]},
        ]}}
        result = MediaWikiClient().get_revision_wikitext([10, 20])
        self.assertEqual(result, {10: {"pageid": 1, "revid": 10, "contentmodel": "wikitext", "wikitext": "{{Infobox}}"}})
        parameters = get.call_args.args[0]
        self.assertEqual(parameters["revids"], "10|20")
        self.assertEqual(parameters["rvslots"], "main")

    @patch.object(MediaWikiClient, "_get")
    def test_get_revision_wikitext_rejects_unexpected_shape(self, get):
        get.return_value = {"query": {"pages": [{"pageid": 1, "revisions": [{"revid": 10}]}]}}
        with self.assertRaises(MediaWikiError):
            MediaWikiClient().get_revision_wikitext([10])

    def test_get_revision_wikitext_rejects_more_than_fifty_revisions(self):
        with self.assertRaises(ValueError):
            MediaWikiClient().get_revision_wikitext(list(range(1, 52)))

    def test_get_pages_rejects_more_than_twenty_extracts(self):
        with self.assertRaisesRegex(ValueError, "at most 20"):
            MediaWikiClient().get_pages(range(21))

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_retries_maxlag_response(self, urlopen, sleep):
        urlopen.side_effect = [
            Response(b'{"error":{"code":"maxlag","info":"waiting"}}'),
            Response(b'{"query":{"categorymembers":[]}}'),
        ]
        payload = MediaWikiClient(retries=1)._get({"action": "query"})
        self.assertEqual(payload["query"]["categorymembers"], [])
        # No Retry-After and no lag: the 5 seconds MediaWiki itself asks for.
        sleep.assert_called_once_with(5.0)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_maxlag_wait_respects_retry_after_header(self, urlopen, sleep):
        urlopen.side_effect = [
            Response(b'{"error":{"code":"maxlag","info":"lag"}}', {"Retry-After": "5"}),
            Response(b'{"entities":{}}'),
        ]
        MediaWikiClient(retries=1)._get({"action": "wbgetentities"})
        sleep.assert_called_once_with(5.0)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
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
    @patch("kpop_scraping.http_request.urlopen")
    def test_client_error_is_not_retried(self, urlopen, sleep):
        urlopen.side_effect = [http_error(404)]
        with self.assertRaisesRegex(MediaWikiError, "HTTP 404"):
            MediaWikiClient(retries=3)._get({"action": "query"})
        sleep.assert_not_called()

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_retry_after_above_limit_stops_without_waiting(self, urlopen, sleep):
        urlopen.side_effect = [http_error(429, {"Retry-After": "3600"})]
        with self.assertRaisesRegex(MediaWikiError, "above the 120s limit"):
            MediaWikiClient(retries=3)._get({"action": "query"})
        sleep.assert_not_called()

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_errors_that_pass_with_time_are_marked_transient(self, urlopen, _sleep):
        maxlag = b'{"error":{"code":"maxlag","info":"Waiting for wdqs1011: 9.6 seconds lagged."}}'
        cases = {
            "maxlag past the wait budget": [Response(maxlag), Response(maxlag)],
            "HTTP 503 until the retries end": [http_error(503), http_error(503)],
            "HTTP 429 until the retries end": [http_error(429), http_error(429)],
            "network failure": [URLError("unreachable"), TimeoutError("timed out")],
            "truncated response": [Response(b'{"query":'), Response(b'{"query":')],
            "TLS failure while reading": [
                FailingResponse(ssl.SSLError("record layer failure")),
                FailingResponse(ssl.SSLError("record layer failure")),
            ],
            "Retry-After above the limit": [http_error(503, {"Retry-After": "3600"})],
        }
        for name, responses in cases.items():
            with self.subTest(name):
                urlopen.side_effect = responses
                client = MediaWikiClient(retries=1, maxlag_budget=MaxlagBudget(5))
                with self.assertRaises(MediaWikiError) as raised:
                    client._get({"action": "query"})
                self.assertTrue(raised.exception.transient)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_errors_that_repeat_are_not_marked_transient(self, urlopen, _sleep):
        cases = {
            "client error": [http_error(404)],
            "API error": [Response(b'{"error":{"code":"badvalue","info":"Unrecognized value"}}')],
            "response that is not an object": [Response(b"[]")],
        }
        for name, responses in cases.items():
            with self.subTest(name):
                urlopen.side_effect = responses
                with self.assertRaises(MediaWikiError) as raised:
                    MediaWikiClient(retries=1)._get({"action": "query"})
                self.assertFalse(raised.exception.transient)
        self.assertFalse(MediaWikiError("unexpected shape").transient)

    @patch("kpop_scraping.http_request.urlopen")
    def test_maxlag_waits_out_the_budget_then_fails_as_transient(self, urlopen):
        info = "Waiting for wdqs1011: 9.6 seconds lagged."
        urlopen.side_effect = lambda *_args, **_kwargs: Response(
            json.dumps({"error": {"code": "maxlag", "info": info, "lag": 9.6}}).encode(),
            {"Retry-After": "10"},
        )
        sleeps = []
        client = MediaWikiClient(maxlag_budget=MaxlagBudget(35, sleep=sleeps.append))
        with self.assertRaises(MediaWikiError) as raised:
            client._get({"action": "wbgetentities"})
        # Three full waits, then the 5 seconds left, then the error.
        self.assertEqual(sleeps, [10.0, 10.0, 10.0, 5.0])
        self.assertEqual(urlopen.call_count, 5)
        error = raised.exception
        self.assertTrue(error.transient)
        self.assertEqual(error.code, "maxlag")
        self.assertEqual(
            str(error),
            "MediaWiki maxlag at https://en.wikipedia.org/w/api.php did not clear within "
            f"the run's 35s wait budget (MAXLAG_BUDGET_SECONDS); last answer: {info}",
        )
        for request in urlopen.call_args_list:
            self.assertIn("maxlag=5", request.args[0].full_url)
            self.assertEqual(request.kwargs["timeout"], 30)

    @patch("kpop_scraping.http_request.urlopen")
    def test_requests_and_clients_of_a_run_share_one_maxlag_budget(self, urlopen):
        maxlag = b'{"error":{"code":"maxlag","info":"lagged"}}'
        urlopen.side_effect = [
            Response(maxlag, {"Retry-After": "20"}),
            Response(b'{"entities":{}}'),
            Response(maxlag, {"Retry-After": "20"}),
            Response(maxlag, {"Retry-After": "20"}),
        ]
        sleeps = []
        budget = MaxlagBudget(30, sleep=sleeps.append)
        MediaWikiClient(maxlag_budget=budget)._get({"action": "query"})
        with self.assertRaisesRegex(MediaWikiError, "within the run's 30s wait budget"):
            MediaWikiClient(maxlag_budget=budget)._get({"action": "query"})
        self.assertEqual(sleeps, [20.0, 10.0])
        self.assertEqual(budget.remaining, 0)

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_maxlag_does_not_use_up_the_network_retries(self, urlopen, sleep):
        maxlag = Response(b'{"error":{"code":"maxlag","info":"lagged"}}')
        urlopen.side_effect = [maxlag, URLError("reset"), Response(b'{"query":{}}')]
        waits = []
        client = MediaWikiClient(retries=1, maxlag_budget=MaxlagBudget(60, sleep=waits.append))
        self.assertEqual(client._get({"action": "query"}), {"query": {}})
        # The maxlag pause comes from the budget, the network backoff does not.
        self.assertEqual(waits, [5.0])
        sleep.assert_called_once_with(1.0)
        self.assertEqual(client.maxlag_budget.spent, 5.0)

    @patch("kpop_scraping.http_request.urlopen")
    def test_maxlag_wait_follows_the_longer_of_retry_after_and_lag_within_bounds(self, urlopen):
        cases = (
            ("Retry-After", {"Retry-After": "12"}, {"lag": 3}, 12.0),
            ("long Retry-After cut to the per-answer limit", {"Retry-After": "3600"}, {}, 120.0),
            ("short Retry-After raised to 5 seconds", {"Retry-After": "1"}, {}, 5.0),
            ("reported lag without Retry-After", {}, {"lag": 13.8}, 13.8),
            ("lag above the Retry-After MediaWiki sends", {"Retry-After": "5"}, {"lag": 13.8}, 13.8),
            ("lag far above the per-answer limit", {}, {"lag": 3600}, 120.0),
            ("integer lag too large for a float", {}, {"lag": 10**400}, 5.0),
            ("invalid Retry-After falls back to the lag", {"Retry-After": "soon"}, {"lag": 9}, 9.0),
            ("lag that is not a number", {}, {"lag": "high"}, 5.0),
            ("lag that is a boolean", {}, {"lag": True}, 5.0),
        )
        for name, headers, extra, expected in cases:
            with self.subTest(name):
                error = {"code": "maxlag", "info": "lagged", **extra}
                urlopen.side_effect = [
                    Response(json.dumps({"error": error}).encode(), headers),
                    Response(b'{"query":{}}'),
                ]
                waits = []
                MediaWikiClient(maxlag_budget=MaxlagBudget(600, sleep=waits.append))._get(
                    {"action": "query"}
                )
                self.assertEqual(waits, [expected])

    @patch("kpop_scraping.http_request.urlopen")
    def test_zero_budget_fails_on_the_first_maxlag(self, urlopen):
        urlopen.side_effect = [Response(b'{"error":{"code":"maxlag","info":"lagged"}}')]
        waits = []
        with self.assertRaises(MediaWikiError) as raised:
            MediaWikiClient(maxlag_budget=MaxlagBudget(0, sleep=waits.append))._get({"action": "query"})
        self.assertTrue(raised.exception.transient)
        self.assertEqual(waits, [])

    def test_maxlag_budget_reads_the_environment(self):
        self.assertEqual(MaxlagBudget.from_environment({}).seconds, DEFAULT_MAXLAG_BUDGET_SECONDS)
        self.assertEqual(DEFAULT_MAXLAG_BUDGET_SECONDS, 15 * 60)
        self.assertEqual(
            MaxlagBudget.from_environment({"MAXLAG_BUDGET_SECONDS": " "}).seconds,
            DEFAULT_MAXLAG_BUDGET_SECONDS,
        )
        self.assertEqual(MaxlagBudget.from_environment({"MAXLAG_BUDGET_SECONDS": "90"}).seconds, 90.0)
        self.assertEqual(MaxlagBudget.from_environment({"MAXLAG_BUDGET_SECONDS": "0"}).seconds, 0.0)
        for value in ("-1", "nan", "inf", "fifteen minutes"):
            with self.subTest(value), self.assertRaisesRegex(ValueError, "MAXLAG_BUDGET_SECONDS"):
                MaxlagBudget.from_environment({"MAXLAG_BUDGET_SECONDS": value})

    def test_client_built_alone_gets_its_own_budget(self):
        first, second = MediaWikiClient(), MediaWikiClient()
        self.assertIsNot(first.maxlag_budget, second.maxlag_budget)
        self.assertEqual(first.maxlag_budget.seconds, DEFAULT_MAXLAG_BUDGET_SECONDS)

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

    @patch.object(MediaWikiClient, "_get")
    def test_resolve_titles_tells_apart_titles_that_land_on_one_page(self, get):
        def page(pageid, title, item):
            return {
                "pageid": pageid, "title": title, "canonicalurl": f"https://example.test/{pageid}",
                "extract": "Intro.", "revisions": [{"revid": pageid * 10}],
                "pageprops": {"wikibase_item": item},
            }

        get.return_value = {
            "query": {
                "normalized": [{"from": "kyujin_(singer)", "to": "Kyujin (singer)"}],
                "redirects": [{"from": "Kyujin (singer)", "to": "Nmixx"}, {"from": "Lily", "to": "Nmixx"}],
                "pages": [
                    page(1, "Nmixx", "Q10"),
                    page(2, "Nayeon", "Q20"),
                    {"title": "Nobody", "missing": True},
                ],
            }
        }
        result = MediaWikiClient().resolve_titles(
            ["kyujin_(singer)", " Nayeon ", "Nmixx", "Lily", "Nobody", "Nayeon"]
        )
        self.assertEqual(
            {title: (item.title, item.is_redirect, item.wikidata_id) for title, item in result.items()},
            {
                "kyujin_(singer)": ("Nmixx", True, "Q10"),
                "Nayeon": ("Nayeon", False, "Q20"),
                "Nmixx": ("Nmixx", False, "Q10"),
                "Lily": ("Nmixx", True, "Q10"),
                "Nobody": ("Nobody", False, None),
            },
        )
        self.assertTrue(result["Nobody"].is_missing)
        self.assertEqual(result["Nayeon"].revision_id, 20)
        self.assertEqual(get.call_args.args[0]["redirects"], "1")
        self.assertEqual(get.call_args.args[0]["titles"].count("|"), 4)

    @patch.object(MediaWikiClient, "_get")
    def test_resolve_titles_survives_a_redirect_loop_and_checks_the_batch_size(self, get):
        get.return_value = {
            "query": {
                "redirects": [{"from": "A", "to": "B"}, {"from": "B", "to": "A"}],
                "pages": [{"pageid": 1, "title": "A"}],
            }
        }
        # A loop never reaches a page, so the title stays unresolved.
        self.assertEqual(MediaWikiClient().resolve_titles(["A"]), {})
        with self.assertRaises(ValueError):
            MediaWikiClient().resolve_titles([f"T{index}" for index in range(21)])
        self.assertEqual(MediaWikiClient().resolve_titles([" "]), {})

    @patch.object(MediaWikiClient, "_get", return_value={"query": {}})
    def test_resolve_titles_rejects_a_response_without_pages(self, _get):
        with self.assertRaisesRegex(MediaWikiError, "unexpected shape"):
            MediaWikiClient().resolve_titles(["A"])


class PageExtractLimitTest(unittest.TestCase):
    def page(self, extract, source_payload=None):
        return Page(1, "A", "https://example.test/A", extract, 42, source_payload)

    def test_limit_is_32_kib(self):
        self.assertEqual(MAX_EXTRACT_BYTES, 32 * 1024)

    def test_extract_at_the_limit_is_kept_and_one_byte_more_is_oversize(self):
        self.assertFalse(self.page("a" * 31 * 1024).is_extract_oversize)
        self.assertFalse(self.page("a" * MAX_EXTRACT_BYTES).is_extract_oversize)
        self.assertTrue(self.page("a" * (MAX_EXTRACT_BYTES + 1)).is_extract_oversize)
        self.assertTrue(self.page("a" * 33 * 1024).is_extract_oversize)

    def test_limit_counts_utf8_bytes_not_characters(self):
        # A Hangul syllable takes three bytes: 10922 fit in the limit, 10923 do not.
        within = self.page("가" * 10922)
        above = self.page("가" * 10923)
        self.assertEqual((within.extract_bytes, above.extract_bytes), (32766, 32769))
        self.assertFalse(within.is_extract_oversize)
        self.assertTrue(above.is_extract_oversize)

    def test_limit_counts_the_extract_kept_in_the_snapshot_payload(self):
        # The stripped extract fits, but the snapshot would store the padded copy.
        padded = "Intro." + " " * MAX_EXTRACT_BYTES
        page = self.page(padded.strip(), {"pageid": 1, "extract": padded})
        self.assertEqual(page.extract_bytes, len(padded))
        self.assertTrue(page.is_extract_oversize)
        self.assertFalse(self.page("Intro.", {"pageid": 1}).is_extract_oversize)

    @patch.object(MediaWikiClient, "_get")
    def test_group_and_title_queries_return_pages_that_know_their_extract_is_oversize(self, get):
        item = {"pageid": 1, "title": "A", "extract": "a" * 33 * 1024, "revisions": [{"revid": 42}]}
        get.return_value = {"query": {"pages": [item]}}
        client = MediaWikiClient()
        self.assertTrue(client.get_pages([1])[0].is_extract_oversize)
        self.assertTrue(client.get_pages_by_titles(["A"])[0].is_extract_oversize)
        self.assertTrue(client.resolve_titles(["A"])["A"].is_extract_oversize)
