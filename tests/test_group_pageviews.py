import json
import unittest
from datetime import date, datetime
from unittest.mock import Mock, patch

from kpop_scraping.group_relevance import (
    PageviewClient,
    PageviewError,
    PageviewMeasurement,
    _retry_delay,
    collect_group_pageviews,
    pageview_window,
)


def _item(day: str, views: int, title: str = "Example") -> dict:
    return {
        "access": "all-access",
        "agent": "user",
        "article": title.replace(" ", "_"),
        "granularity": "daily",
        "project": "en.wikipedia",
        "timestamp": day.replace("-", "") + "00",
        "views": views,
    }


class GroupPageviewTest(unittest.TestCase):
    def test_window_uses_only_completed_days(self):
        start, end = pageview_window(date(2026, 9, 22))
        self.assertEqual((start, end), ("2025-09-21", "2026-09-20"))
        self.assertEqual((date.fromisoformat(end) - date.fromisoformat(start)).days + 1, 365)
        self.assertEqual((date(2026, 9, 22) - date.fromisoformat(end)).days, 2)


    def test_measurement_is_canonical_and_sums_daily_items(self):
        payload = {"items": [_item("2026-01-01", 4), _item("2026-01-02", 9)]}
        result = PageviewClient._measurement(
            "Example", "2026-01-01", "2026-01-02", "https://example.test", payload
        )
        self.assertEqual(result.total_views, 13)
        self.assertEqual(result.days_observed, 2)
        self.assertEqual(result.response_json, json.dumps(payload, separators=(",", ":"), sort_keys=True))
        self.assertEqual(len(result.response_sha256), 64)

    def test_measurement_treats_a_leading_gap_as_zero_and_rejects_holes(self):
        payload = {"items": [_item("2026-01-02", 5), _item("2026-01-03", 7)]}
        result = PageviewClient._measurement(
            "Example", "2026-01-01", "2026-01-03", "https://example.test", payload
        )
        self.assertEqual(result.total_views, 12)
        self.assertEqual(result.days_observed, 2)
        with self.assertRaises(PageviewError):
            PageviewClient._measurement(
                "Example", "2026-01-01", "2026-01-03", "url",
                {"items": [_item("2026-01-01", 1), _item("2026-01-03", 1)]},
            )

    def test_measurement_rejects_missing_final_day_wrong_article_and_invalid_counts(self):
        with self.assertRaises(PageviewError):
            PageviewClient._measurement(
                "Example", "2026-01-01", "2026-01-02", "url",
                {"items": [_item("2026-01-01", 4)]},
            )
        with self.assertRaises(PageviewError):
            PageviewClient._measurement(
                "Example", "2026-01-01", "2026-01-01", "url",
                {"items": [_item("2026-01-01", 4, title="Other")]},
            )
        with self.assertRaises(PageviewError):
            PageviewClient._measurement(
                "Example", "2026-01-01", "2026-01-01", "url", {"items": [{"views": -1}]}
            )

    def test_retry_delay_honors_retry_after_on_429(self):
        self.assertEqual(_retry_delay(0, 429, "17"), 17.0)
        self.assertEqual(_retry_delay(0, 500, None), 1.0)
        self.assertEqual(_retry_delay(0, 429, "500"), 120.0)

    def test_collection_completes_one_run_with_all_measurements(self):
        repository = Mock()
        repository.accepted_group_pages.return_value = [
            {"entity_id": 1, "page_title": "Alpha"},
            {"entity_id": 2, "page_title": "Beta"},
        ]
        repository.start_group_pageview_run.return_value = 7
        client = Mock()
        client.fetch.side_effect = [
            PageviewMeasurement("Alpha", "2025-09-21", "2026-09-20", 10, 365, "u1", "{}", "a" * 64),
            PageviewMeasurement("Beta", "2025-09-21", "2026-09-20", 20, 365, "u2", "{}", "b" * 64),
        ]

        count = collect_group_pageviews(
            repository, client, date(2026, 9, 22), pause_seconds=0
        )

        self.assertEqual(count, 2)
        repository.start_group_pageview_run.assert_called_once_with(
            "2025-09-21", "2026-09-20", 2
        )
        self.assertEqual(repository.save_group_pageviews.call_count, 2)
        repository.complete_group_pageview_run.assert_called_once_with(7, 2)
        repository.fail_group_pageview_run.assert_not_called()

    def test_collection_marks_the_run_failed_when_a_request_fails(self):
        repository = Mock()
        repository.accepted_group_pages.return_value = [
            {"entity_id": 1, "page_title": "Alpha"}
        ]
        repository.start_group_pageview_run.return_value = 9
        client = Mock()
        client.fetch.side_effect = PageviewError("unavailable")

        with self.assertRaisesRegex(PageviewError, "unavailable"):
            collect_group_pageviews(
                repository, client, date(2026, 9, 22), pause_seconds=0
            )

        repository.fail_group_pageview_run.assert_called_once_with(9, "unavailable")
        repository.complete_group_pageview_run.assert_not_called()


    def test_pageview_window_validates_days(self):
        with self.assertRaises(ValueError):
            pageview_window(date(2026, 9, 22), days=0)

    def test_expected_timestamps_rejects_reversed_window(self):
        from kpop_scraping.group_relevance import _expected_timestamps
        with self.assertRaisesRegex(PageviewError, "ends before it starts"):
            _expected_timestamps("2026-01-02", "2026-01-01")

    def test_client_init_validates_arguments(self):
        with self.assertRaisesRegex(ValueError, "user_agent must not be empty"):
            PageviewClient("")
        with self.assertRaisesRegex(ValueError, "timeout must be positive"):
            PageviewClient("Agent", timeout=0)
        with self.assertRaisesRegex(ValueError, "retries cannot be negative"):
            PageviewClient("Agent", retries=-1)
        client = PageviewClient("Agent", timeout=10, retries=5)
        self.assertEqual(client.user_agent, "Agent")
        self.assertEqual(client.timeout, 10)
        self.assertEqual(client.retries, 5)

    def test_client_fetch_validates_arguments(self):
        client = PageviewClient("Agent")
        with self.assertRaisesRegex(ValueError, "page title must not be empty"):
            client.fetch("  ", "2026-01-01", "2026-01-02")
        with self.assertRaisesRegex(ValueError, "dates must use YYYY-MM-DD"):
            client.fetch("A", "2026-01-0", "2026-01-02")
        with self.assertRaisesRegex(ValueError, "dates must use YYYY-MM-DD"):
            client.fetch("A", "2026-01-01", "2026-01-0")

    @patch("kpop_scraping.group_relevance.urlopen")
    @patch("kpop_scraping.group_relevance.json.load")
    def test_client_fetch_success(self, mock_json_load, mock_urlopen):
        mock_json_load.return_value = {"items": [_item("2026-01-01", 10)]}
        mock_response = Mock()
        mock_urlopen.return_value.__enter__.return_value = mock_response
        client = PageviewClient("Agent")
        result = client.fetch("Example", "2026-01-01", "2026-01-01")
        self.assertEqual(result.title, "Example")
        self.assertEqual(result.total_views, 10)
        self.assertEqual(result.days_observed, 1)

    @patch("kpop_scraping.group_relevance.time.sleep")
    @patch("kpop_scraping.group_relevance.urlopen")
    @patch("kpop_scraping.group_relevance.json.load")
    def test_client_fetch_retries_on_http_error(self, mock_json_load, mock_urlopen, mock_sleep):
        from urllib.error import HTTPError

        error_429 = HTTPError("url", 429, "Too Many Requests", {"Retry-After": "2"}, None)

        mock_response = Mock()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=None)
        mock_urlopen.side_effect = [error_429, mock_response]
        mock_json_load.return_value = {"items": [_item("2026-01-01", 10)]}

        client = PageviewClient("Agent", retries=1)
        result = client.fetch("Example", "2026-01-01", "2026-01-01")

        self.assertEqual(result.total_views, 10)
        self.assertEqual(mock_sleep.call_count, 1)
        mock_sleep.assert_called_with(2.0)

    @patch("kpop_scraping.group_relevance.time.sleep")
    @patch("kpop_scraping.group_relevance.urlopen")
    def test_client_fetch_fails_on_non_retryable_http_error(self, mock_urlopen, mock_sleep):
        from urllib.error import HTTPError

        error_404 = HTTPError("url", 404, "Not Found", {}, None)
        mock_urlopen.side_effect = error_404

        client = PageviewClient("Agent")
        with self.assertRaisesRegex(PageviewError, "failed with HTTP 404"):
            client.fetch("Example", "2026-01-01", "2026-01-01")

        mock_sleep.assert_not_called()

    @patch("kpop_scraping.group_relevance.time.sleep")
    @patch("kpop_scraping.group_relevance.urlopen")
    def test_client_fetch_exhausts_retries(self, mock_urlopen, mock_sleep):
        from urllib.error import URLError

        mock_urlopen.side_effect = URLError("Network down")

        client = PageviewClient("Agent", retries=2)
        with self.assertRaisesRegex(PageviewError, "failed after retries"):
            client.fetch("Example", "2026-01-01", "2026-01-01")

        self.assertEqual(mock_sleep.call_count, 2)

    def test_client_fetch_fails_when_all_retries_fail_with_http_error(self):
        from urllib.error import HTTPError
        error_500 = HTTPError("url", 500, "Internal Server Error", {}, None)
        with patch("kpop_scraping.group_relevance.urlopen") as mock_urlopen, \
             patch("kpop_scraping.group_relevance.time.sleep") as mock_sleep:
            mock_urlopen.side_effect = [error_500, error_500, error_500]
            client = PageviewClient("Agent", retries=2)
            with self.assertRaisesRegex(PageviewError, "failed with HTTP 500"):
                client.fetch("Example", "2026-01-01", "2026-01-01")
            self.assertEqual(mock_sleep.call_count, 2)

    def test_measurement_rejects_missing_days(self):
        with self.assertRaisesRegex(PageviewError, "contains no days"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": []})
        with self.assertRaisesRegex(PageviewError, "unexpected shape"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": "not a list"})

    def test_measurement_rejects_invalid_counts_and_wrong_article(self):
        with self.assertRaisesRegex(PageviewError, "contains an invalid view count"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": [_item("2026-01-01", -1)]})
        with self.assertRaisesRegex(PageviewError, "is for a different article"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": [_item("2026-01-01", 1, title="Other")]})

    def test_measurement_rejects_wrong_series(self):
        item = _item("2026-01-01", 1)
        item["project"] = "ko.wikipedia"
        with self.assertRaisesRegex(PageviewError, "does not match the requested series"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": [item]})

    def test_measurement_rejects_out_of_window_day(self):
        with self.assertRaisesRegex(PageviewError, "contains a day outside the window"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": [_item("2026-01-03", 1)]})

    def test_measurement_rejects_repeated_day(self):
        with self.assertRaisesRegex(PageviewError, "repeats a day"):
            PageviewClient._measurement("Example", "2026-01-01", "2026-01-02", "url", {"items": [_item("2026-01-01", 1), _item("2026-01-01", 2)]})

    def test_collect_group_pageviews_validates_group_limit(self):
        repository = Mock()
        client = Mock()
        with self.assertRaisesRegex(ValueError, "group_limit must be positive"):
            collect_group_pageviews(repository, client, date(2026, 9, 22), group_limit=0)

    def test_collect_group_pageviews_validates_pause_seconds(self):
        repository = Mock()
        client = Mock()
        with self.assertRaisesRegex(ValueError, "pause_seconds cannot be negative"):
            collect_group_pageviews(repository, client, date(2026, 9, 22), pause_seconds=-1.0)



    def test_collect_group_pageviews_respects_group_limit(self):
        repository = Mock()
        repository.accepted_group_pages.return_value = [
            {"entity_id": 1, "page_title": "Alpha"},
            {"entity_id": 2, "page_title": "Beta"},
        ]
        repository.start_group_pageview_run.return_value = 7
        client = Mock()
        client.fetch.side_effect = [
            PageviewMeasurement("Alpha", "2025-09-21", "2026-09-20", 10, 365, "u1", "{}", "a" * 64)
        ]

        # Use group_limit=1 to cover line 187
        count = collect_group_pageviews(
            repository, client, date(2026, 9, 22), pause_seconds=0, group_limit=1
        )
        self.assertEqual(count, 1)

    def test_collect_group_pageviews_pauses_between_fetches(self):
        repository = Mock()
        repository.accepted_group_pages.return_value = [
            {"entity_id": 1, "page_title": "Alpha"},
            {"entity_id": 2, "page_title": "Beta"},
        ]
        repository.start_group_pageview_run.return_value = 7
        client = Mock()
        client.fetch.side_effect = [
            PageviewMeasurement("Alpha", "2025-09-21", "2026-09-20", 10, 365, "u1", "{}", "a" * 64),
            PageviewMeasurement("Beta", "2025-09-21", "2026-09-20", 20, 365, "u2", "{}", "b" * 64),
        ]

        with patch("kpop_scraping.group_relevance.time.sleep") as mock_sleep:
            # Provide pause_seconds=2.0 to cover line 193
            count = collect_group_pageviews(
                repository, client, date(2026, 9, 22), pause_seconds=2.0
            )
            self.assertEqual(count, 2)
            mock_sleep.assert_called_once_with(2.0)


    def test_client_fetch_exhausts_retries_unexpected_exit(self):
        # To cover `raise AssertionError("retry loop exited unexpectedly")`
        # We need a way to break the retry loop without hitting return or raise inside it.
        # This is a bit tricky since the loop is `for attempt in range(...)`
        # and all paths either return or raise, or go to next iteration.
        # But if we change `self.retries` dynamically, we might be able to trick it?
        # Actually, Python's for loop over a range evaluates the range once.
        # Let's mock range itself if possible? No.
        # We can just mock the whole loop with an empty range? No, range is determined by self.retries + 1.
        # Let's just set retries to -1 using a trick (if validation didn't catch it).
        # We validate retries in __init__, so we bypass it.
        client = PageviewClient("Agent")
        client.retries = -1
        with self.assertRaisesRegex(AssertionError, "retry loop exited unexpectedly"):
            client.fetch("Example", "2026-01-01", "2026-01-01")

if __name__ == "__main__":


    unittest.main()
