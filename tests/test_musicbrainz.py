import unittest
from unittest.mock import patch, Mock, MagicMock
from io import BytesIO
import json
from urllib.error import HTTPError, URLError

from kpop_scraping.musicbrainz import MusicBrainzClient, MusicBrainzError

class Response(BytesIO):
    def __init__(self, content, headers=None, status=200):
        super().__init__(content)
        self.headers = headers or {}
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

def http_error(code, headers=None):
    return HTTPError("https://example.test/api", code, "error", headers or {}, None)

class MusicBrainzClientTest(unittest.TestCase):
    @patch.object(MusicBrainzClient, "_get")
    def test_lookup_constructs_url(self, get_mock):
        get_mock.return_value = {"id": "123"}
        client = MusicBrainzClient(api_url="https://test.api")
        result = client.lookup("artist", "123", ("aliases",))
        self.assertEqual(result, {"id": "123"})
        get_mock.assert_called_once_with("https://test.api/artist/123?fmt=json&inc=aliases")

    def test_lookup_rejects_unsupported_entity(self):
        client = MusicBrainzClient()
        with self.assertRaises(ValueError):
            client.lookup("invalid_entity", "123")

    @patch("kpop_scraping.musicbrainz.urlopen")
    def test_get_returns_json_payload(self, urlopen_mock):
        payload = {"data": "test"}
        urlopen_mock.return_value = Response(json.dumps(payload).encode("utf-8"))
        client = MusicBrainzClient()

        client._sleep = Mock()

        result = client._get("https://test.api/artist/123")
        self.assertEqual(result, payload)

    @patch("kpop_scraping.musicbrainz.urlopen")
    def test_get_retries_retryable_error(self, urlopen_mock):
        payload = {"data": "success"}
        urlopen_mock.side_effect = [
            http_error(503, {"Retry-After": "1"}),
            Response(json.dumps(payload).encode("utf-8"))
        ]

        # When _wait_for_slot calls self._sleep(remaining), it will be remaining = min_interval (1.1).
        # We don't really care about testing _wait_for_slot here, so we will use any_call
        clock_mock = Mock(return_value=0.0)
        sleep_mock = Mock()
        client = MusicBrainzClient(retries=1, clock=clock_mock, sleep=sleep_mock)

        result = client._get("https://test.api/artist/123")
        self.assertEqual(result, payload)
        self.assertEqual(urlopen_mock.call_count, 2)
        # sleep gets called from _wait_for_slot (1.1) and _retry_delay (1.0)
        sleep_mock.assert_any_call(1.0) # max(2**0, 1.0) = 1.0

    @patch("kpop_scraping.musicbrainz.urlopen")
    def test_get_fails_on_non_retryable_error(self, urlopen_mock):
        urlopen_mock.side_effect = http_error(404)

        clock_mock = Mock(return_value=0.0)
        sleep_mock = Mock()
        client = MusicBrainzClient(retries=1, clock=clock_mock, sleep=sleep_mock)

        with self.assertRaises(MusicBrainzError) as ctx:
            client._get("https://test.api/artist/123")

        self.assertIn("HTTP 404", str(ctx.exception))
        self.assertEqual(urlopen_mock.call_count, 1)

    @patch("kpop_scraping.musicbrainz.urlopen")
    def test_get_exhausts_retries(self, urlopen_mock):
        urlopen_mock.side_effect = [
            http_error(503),
            http_error(503)
        ]

        clock_mock = Mock(return_value=0.0)
        sleep_mock = Mock()
        client = MusicBrainzClient(retries=1, clock=clock_mock, sleep=sleep_mock)

        with self.assertRaises(MusicBrainzError):
            client._get("https://test.api/artist/123")

        self.assertEqual(urlopen_mock.call_count, 2)

    def test_wait_for_slot_sleeps(self):
        clock_mock = Mock(side_effect=[0.5, 0.5])
        sleep_mock = Mock()

        client = MusicBrainzClient(min_interval=1.0, clock=clock_mock, sleep=sleep_mock)
        client._last_request = 0.0

        client._wait_for_slot()

        sleep_mock.assert_called_once_with(0.5) # 1.0 - (0.5 - 0.0) = 0.5
        self.assertEqual(client._last_request, 0.5)

    def test_wait_for_slot_does_not_sleep(self):
        clock_mock = Mock(side_effect=[1.5, 1.5])
        sleep_mock = Mock()

        client = MusicBrainzClient(min_interval=1.0, clock=clock_mock, sleep=sleep_mock)
        client._last_request = 0.0

        client._wait_for_slot()

        sleep_mock.assert_not_called()
        self.assertEqual(client._last_request, 1.5)

    def test_retry_delay_calculates_backoff(self):
        self.assertEqual(MusicBrainzClient._retry_delay(0, {}), 1.0)
        self.assertEqual(MusicBrainzClient._retry_delay(1, {}), 2.0)
        self.assertEqual(MusicBrainzClient._retry_delay(2, {}), 4.0)

    def test_retry_delay_uses_retry_after(self):
        headers = {"Retry-After": "5"}
        self.assertEqual(MusicBrainzClient._retry_delay(0, headers), 5.0)

if __name__ == '__main__':
    unittest.main()
