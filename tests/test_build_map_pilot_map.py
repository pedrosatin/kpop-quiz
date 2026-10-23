import io
import json
import unittest
from unittest import mock

from scripts.build_map_pilot_map import (
    SOURCE_URL,
    USER_AGENT,
    download_features,
)

class BuildMapPilotMapTest(unittest.TestCase):
    def test_download_features_requests_url_with_agent_and_timeout(self):
        payload = {"type": "FeatureCollection", "features": [{"id": "TEST"}]}
        response_bytes = json.dumps(payload).encode("utf-8")

        def fake_urlopen(request, timeout):
            self.assertEqual(request.full_url, SOURCE_URL)
            self.assertEqual(request.get_header("User-agent"), USER_AGENT)
            self.assertEqual(timeout, 30)
            return io.BytesIO(response_bytes)

        with mock.patch("scripts.build_map_pilot_map.urlopen", side_effect=fake_urlopen):
            result = download_features()

        self.assertEqual(result, payload)

if __name__ == '__main__':
    unittest.main()
