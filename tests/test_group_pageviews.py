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
from kpop_scraping.group_relevance_cli import default_reference_date


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

    def test_default_reference_date_uses_utc(self):
        class FixedDatetime:
            @classmethod
            def now(cls, tz):
                self.assertIsNotNone(tz)
                return datetime(2026, 9, 21, 0, 30)

        with patch("kpop_scraping.group_relevance_cli.datetime", FixedDatetime):
            self.assertEqual(default_reference_date(), date(2026, 9, 21))

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


if __name__ == "__main__":
    unittest.main()
