import json
import unittest
from decimal import Decimal
from unittest.mock import patch
from urllib.error import HTTPError

from kpop_scraping.group_signals_cli import _attach_live_statistics, collect_report
from kpop_scraping.group_signals import (
    SignalError,
    extract_group_signals,
    fetch_youtube_statistics,
    parse_youtube_statistics,
    select_rankable_signals,
)
from kpop_scraping.wikidata import EntityBatch, EntityDocument


BTS_CHANNEL = "UC" + "a" * 21 + "A"
SM_CHANNEL = "UC" + "b" * 21 + "Q"
DEPRECATED_CHANNEL = "UC" + "c" * 21 + "g"


def statement(property_id: str, value: object, rank: str = "normal", qualifiers: dict | None = None) -> dict:
    datatype = "string" if isinstance(value, str) else "quantity" if isinstance(value, Decimal) else "time"
    if isinstance(value, Decimal):
        stored = {"amount": f"+{value}", "unit": "1"}
    elif isinstance(value, str) and value.startswith("+"):
        stored = {"time": value, "precision": 11, "calendarmodel": "http://www.wikidata.org/entity/Q1985727"}
        datatype = "time"
    else:
        stored = value
    return {
        "id": f"Q1${property_id}-{str(value).replace(' ', '-')}",
        "rank": rank,
        "mainsnak": {"snaktype": "value", "property": property_id, "datavalue": {"type": datatype, "value": stored}},
        "qualifiers": qualifiers or {},
    }


def qualifier(property_id: str, value: str) -> dict:
    return {"snaktype": "value", "property": property_id, "datavalue": {"type": "string", "value": value}}


def time_qualifier(day: str) -> dict:
    return {
        "snaktype": "value",
        "property": "P585",
        "datavalue": {
            "type": "time",
            "value": {"time": f"+{day}T00:00:00Z", "precision": 11},
        },
    }


class GroupSignalTest(unittest.TestCase):
    @patch("kpop_scraping.group_signals_cli.WikidataEntityClient")
    def test_report_keeps_wikidata_revision_and_resolved_id(self, client_class):
        payload = {
            "id": "Q2",
            "lastrevid": 1234,
            "claims": {"P2397": [statement("P2397", BTS_CHANNEL)]},
        }
        client_class.return_value.get_entities.return_value = EntityBatch(
            (EntityDocument("Q1", "Q2", 1234, payload),),
            (),
        )

        report = collect_report(
            [{"wikidata_id": "Q1", "canonical_name": "Group", "enwiki_title": "Group"}],
            "test-agent",
            0,
            "",
        )

        row = report["groups"][0]
        self.assertTrue(row["wikidata_found"])
        self.assertEqual(row["wikidata_resolved_id"], "Q2")
        self.assertEqual(row["wikidata_revision_id"], 1234)
        self.assertNotIn("test-agent", json.dumps(report))

    @patch("kpop_scraping.group_signals_cli.time.sleep")
    @patch("kpop_scraping.group_signals_cli.fetch_youtube_statistics")
    def test_live_statistics_are_fetched_in_batches_of_fifty(self, fetch, sleep):
        rows = [
            {
                "channels": [
                    {"id": "UC" + f"{index:021d}" + "A", "rank": "normal"}
                ]
            }
            for index in range(51)
        ]
        fetch.side_effect = lambda ids, _key: {
            channel_id: {
                "subscriber_count": 1,
                "hidden_subscriber_count": False,
                "view_count": 2,
                "video_count": 3,
            }
            for channel_id in ids
        }

        _attach_live_statistics(rows, "secret-value", 0.5)

        self.assertEqual([len(call.args[0]) for call in fetch.call_args_list], [50, 1])
        sleep.assert_called_once_with(0.5)
        self.assertTrue(all(len(row["live_statistics"]) == 1 for row in rows))
        self.assertNotIn("secret-value", json.dumps(rows))

    def test_keeps_latest_youtube_snapshot_and_drops_twitter_followers(self):
        entity = {
            "claims": {
                "P2397": [
                    statement("P2397", BTS_CHANNEL, "preferred"),
                    statement("P2397", "not-a-channel"),
                    statement("P2397", DEPRECATED_CHANNEL, "deprecated"),
                ],
                "P11245": [statement("P11245", "BTS")],
                "P8687": [
                    statement(
                        "P8687",
                        Decimal(40000000),
                        qualifiers={"P2397": [qualifier("P2397", BTS_CHANNEL)], "P585": [time_qualifier("2021-07-02")]},
                    ),
                    statement(
                        "P8687",
                        Decimal(82000000),
                        qualifiers={"P2397": [qualifier("P2397", BTS_CHANNEL)], "P585": [time_qualifier("2025-03-10")]},
                    ),
                    statement(
                        "P8687",
                        Decimal(70000000),
                        qualifiers={"P6552": [qualifier("P6552", "123")]},
                    ),
                ],
            }
        }
        signals = extract_group_signals(entity)
        self.assertEqual(signals["channels"][0]["id"], BTS_CHANNEL)
        self.assertEqual(signals["channels"][0]["rank"], "preferred")
        self.assertEqual(signals["channels"][0]["property_id"], "P2397")
        self.assertIn("statement_id", signals["channels"][0])
        self.assertEqual(signals["handles"][0]["id"], "BTS")
        self.assertEqual(signals["handles"][0]["property_id"], "P11245")
        self.assertEqual(
            [item["count"] for item in signals["subscriber_snapshots"]],
            [40000000, 82000000],
        )
        self.assertTrue(
            all(item["property_id"] == "P8687" for item in signals["subscriber_snapshots"])
        )
        self.assertTrue(
            all(item["locator"].startswith("claims/P8687/") for item in signals["subscriber_snapshots"])
        )
        row = {"wikidata_id": "Q13580495", **signals}
        select_rankable_signals([row])
        self.assertEqual(row["selected_subscribers"], 82000000)
        self.assertEqual(row["selected_as_of"], "2025-03-10")
        self.assertTrue(row["usable_for_rank"])

    def test_youtube_handle_snapshot_is_rankable_without_a_channel_qualifier(self):
        handle = "StrayKids"
        signals = extract_group_signals(
            {
                "claims": {
                    "P2397": [statement("P2397", BTS_CHANNEL)],
                    "P8687": [
                        statement(
                            "P8687",
                            Decimal(23400000),
                            qualifiers={"P11245": [qualifier("P11245", handle)], "P585": [time_qualifier("2026-03-28")]},
                        ),
                        statement(
                            "P8687",
                            Decimal(45300000),
                            qualifiers={"P7085": [qualifier("P7085", "bts_official_bighit")]},
                        ),
                    ],
                }
            }
        )
        self.assertEqual(signals["subscriber_snapshots"][0]["handle"], handle)
        self.assertEqual(len(signals["subscriber_snapshots"]), 1)
        row = {"wikidata_id": "Q46134670", **signals}
        select_rankable_signals([row])
        self.assertEqual(row["selected_subscribers"], 23400000)
        self.assertEqual(row["selected_handle"], handle)
        self.assertIsNone(row["selected_channel_id"])
        self.assertTrue(row["usable_for_rank"])

    def test_shared_channel_is_not_rankable(self):
        def row(qid: str) -> dict:
            return {
                "wikidata_id": qid,
                **extract_group_signals(
                    {
                        "claims": {
                            "P2397": [statement("P2397", SM_CHANNEL)],
                            "P8687": [
                                statement(
                                    "P8687",
                                    Decimal(33100000),
                                    qualifiers={
                                        "P2397": [qualifier("P2397", SM_CHANNEL)],
                                        "P585": [time_qualifier("2025-04-24")],
                                    },
                                )
                            ],
                        }
                    }
                ),
            }

        groups = [row("Q1"), row("Q2")]
        select_rankable_signals(groups)
        self.assertTrue(all(group["channels"][0]["shared"] for group in groups))
        self.assertTrue(all(group["selected_subscribers"] == 33100000 for group in groups))
        self.assertTrue(all(group["usable_for_rank"] is False for group in groups))

    def test_prefers_unshared_channel_over_a_larger_shared_one(self):
        own = "UC" + "d" * 21 + "w"
        row = {
            "wikidata_id": "Q10",
            "channels": [
                {"id": SM_CHANNEL, "rank": "normal"},
                {"id": own, "rank": "preferred"},
            ],
            "subscriber_snapshots": [
                {"channel_id": SM_CHANNEL, "count": 33000000, "point_in_time": "2025-04-24", "rank": "normal"},
                {"channel_id": own, "count": 900000, "point_in_time": "2025-01-01", "rank": "normal"},
            ],
        }
        other = {
            "wikidata_id": "Q11",
            "channels": [{"id": SM_CHANNEL, "rank": "normal"}],
            "subscriber_snapshots": [],
        }
        select_rankable_signals([row, other])
        self.assertEqual(row["selected_channel_id"], own)
        self.assertEqual(row["selected_subscribers"], 900000)
        self.assertTrue(row["usable_for_rank"])

    def test_youtube_statistics_parser_requires_integer_counts(self):
        parsed = parse_youtube_statistics(
            {
                "items": [
                    {
                        "id": BTS_CHANNEL,
                        "statistics": {
                            "subscriberCount": "82000000",
                            "hiddenSubscriberCount": False,
                            "viewCount": "25000000000",
                            "videoCount": "400",
                        },
                    }
                ]
            }
        )
        self.assertEqual(parsed[BTS_CHANNEL]["subscriber_count"], 82000000)
        self.assertFalse(parsed[BTS_CHANNEL]["hidden_subscriber_count"])
        with self.assertRaises(SignalError):
            parse_youtube_statistics({"items": [{"id": BTS_CHANNEL, "statistics": {"subscriberCount": "hidden"}}]})

    def test_youtube_statistics_parser_accepts_hidden_subscriber_counts(self):
        parsed = parse_youtube_statistics(
            {
                "items": [
                    {
                        "id": BTS_CHANNEL,
                        "statistics": {
                            "hiddenSubscriberCount": True,
                            "viewCount": "25000000000",
                            "videoCount": "400",
                        },
                    }
                ]
            }
        )
        self.assertIsNone(parsed[BTS_CHANNEL]["subscriber_count"])
        self.assertTrue(parsed[BTS_CHANNEL]["hidden_subscriber_count"])

    def test_youtube_request_is_skipped_without_calling_when_ids_are_invalid(self):
        with patch("kpop_scraping.group_signals.urlopen") as urlopen:
            with self.assertRaises(SignalError):
                fetch_youtube_statistics(["channel-name"], "key")
        urlopen.assert_not_called()

    def test_youtube_transport_error_stays_a_signal_error(self):
        transport_error = HTTPError(
            "https://www.googleapis.com/youtube/v3/channels?key=secret-value",
            403,
            "Forbidden",
            None,
            None,
        )
        with patch("kpop_scraping.group_signals.urlopen", side_effect=transport_error):
            with self.assertRaisesRegex(SignalError, "^YouTube statistics request failed$") as caught:
                fetch_youtube_statistics([BTS_CHANNEL], "secret-value")
        self.assertIsNone(caught.exception.__cause__)
        self.assertIsNone(caught.exception.__context__)
        self.assertNotIn("secret-value", repr(caught.exception))
        transport_error.close()

    def test_youtube_response_rejects_an_unrequested_channel(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps(
            {
                "items": [
                    {
                        "id": SM_CHANNEL,
                        "statistics": {
                            "subscriberCount": "1",
                            "viewCount": "2",
                            "videoCount": "3",
                        },
                    }
                ]
            }
        ).encode()
        with patch("kpop_scraping.group_signals.urlopen", return_value=response):
            with self.assertRaisesRegex(SignalError, "unexpected channel IDs"):
                fetch_youtube_statistics([BTS_CHANNEL], "secret-value")


if __name__ == "__main__":
    unittest.main()
