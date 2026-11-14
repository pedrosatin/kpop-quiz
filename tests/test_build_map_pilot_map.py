import hashlib
import io
import json
import math
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from scripts import build_map_pilot_map
from scripts.build_map_pilot_map import (
    WIDTH,
    SourceHashError,
    HEIGHT,
    build_map,
    distance_to_segment,
    download_features,
    geometry_path,
    main,
    project,
    ring_path,
    simplify,
    split_antimeridian_ring,
)


class TestGeometryAndProjection(unittest.TestCase):
    def test_project(self):
        # 0, 0 is center
        x, y = project([0.0, 0.0])
        self.assertAlmostEqual(x, WIDTH / 2)
        self.assertAlmostEqual(y, HEIGHT / 2)

        # 180, -90 is bottom right
        x, y = project([180.0, -90.0])
        self.assertAlmostEqual(x, WIDTH)
        self.assertAlmostEqual(y, HEIGHT)

        # -180, 90 is top left
        x, y = project([-180.0, 90.0])
        self.assertAlmostEqual(x, 0)
        self.assertAlmostEqual(y, 0)

    def test_distance_to_segment(self):
        # Point on the segment
        self.assertEqual(distance_to_segment((5, 5), (0, 0), (10, 10)), 0.0)

        # Point orthogonal to the segment
        self.assertAlmostEqual(distance_to_segment((0, 10), (0, 0), (10, 0)), 10.0)

        # Point beyond start
        self.assertAlmostEqual(distance_to_segment((-5, 0), (0, 0), (10, 0)), 5.0)

        # Point beyond end
        self.assertAlmostEqual(distance_to_segment((15, 0), (0, 0), (10, 0)), 5.0)

        # Segment is a point
        self.assertAlmostEqual(
            distance_to_segment((5, 5), (0, 0), (0, 0)), math.hypot(5, 5)
        )

    def test_simplify(self):
        # The simplify function always returns at least len < 4 points as is!
        points = [(0.0, 0.0), (5.0, 0.1), (10.0, 0.0)]
        self.assertEqual(simplify(points, tolerance=0.5), points)
        self.assertEqual(simplify(points, tolerance=0.05), points)

        # 4 points, can be simplified
        points4 = [(0.0, 0.0), (3.0, 0.1), (6.0, -0.1), (9.0, 0.0)]
        self.assertEqual(simplify(points4, tolerance=0.5), [(0.0, 0.0), (9.0, 0.0)])

        # Further point not found (no point furhter than tolerance?)
        # Wait, if furthest is None, distance is checked... but furthest can only be None if loop is empty
        # `furthest = max(range(start + 1, end), ...)`
        # If start + 1 == end, range is empty, max with default=None returns None
        points_simple = [(0.0, 0.0), (1.0, 0.0)]
        self.assertEqual(
            simplify(points_simple, tolerance=0.5), [(0.0, 0.0), (1.0, 0.0)]
        )

        # What if distance <= tolerance?
        points4_close = [(0.0, 0.0), (3.0, 0.1), (6.0, -0.1), (9.0, 0.0)]
        self.assertEqual(
            simplify(points4_close, tolerance=0.5), [(0.0, 0.0), (9.0, 0.0)]
        )

    def test_split_antimeridian_ring(self):
        # Doesn't cross
        ring = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]]
        self.assertEqual(split_antimeridian_ring(ring), [ring])

        # Crosses antimeridian
        ring_cross = [[170.0, 0.0], [179.0, 0.0], [-179.0, 0.0], [-170.0, 0.0]]
        self.assertEqual(
            split_antimeridian_ring(ring_cross), []
        )  # Since neither chunk is >= 3 points

        ring_cross_valid = [
            [170.0, 0.0],
            [175.0, 0.0],
            [179.0, 0.0],
            [-179.0, 0.0],
            [-175.0, 0.0],
            [-170.0, 0.0],
        ]
        self.assertEqual(
            split_antimeridian_ring(ring_cross_valid),
            [
                [[170.0, 0.0], [175.0, 0.0], [179.0, 0.0]],
                [[-179.0, 0.0], [-175.0, 0.0], [-170.0, 0.0]],
            ],
        )


class TestPathRendering(unittest.TestCase):
    def test_ring_path(self):
        ring = [[0.0, 0.0], [90.0, 0.0], [90.0, 90.0], [0.0, 90.0]]
        path = ring_path(ring)
        self.assertTrue(path.startswith("M"))
        self.assertTrue(path.endswith("Z"))
        self.assertEqual(path.count("M"), 1)
        self.assertEqual(path.count("L"), 3)
        self.assertEqual(path.count("Z"), 1)

        # Too few points
        ring_small = [[0.0, 0.0], [1.0, 1.0]]
        self.assertEqual(ring_path(ring_small), "")

        # Crosses antimeridian but one part is too small
        ring_antimeridian = [
            [170.0, 0.0],
            [175.0, 0.0],
            [179.0, 0.0],
            [-179.0, 0.0],
            [-170.0, 0.0],
        ]
        self.assertTrue(ring_path(ring_antimeridian).startswith("M"))
        self.assertEqual(ring_path(ring_antimeridian).count("M"), 1)

        # Simplify removes everything so points < 3
        with mock.patch("scripts.build_map_pilot_map.simplify") as mock_simplify:
            mock_simplify.return_value = [[0.0, 0.0], [1.0, 1.0]]
            self.assertEqual(ring_path(ring), "")

    def test_geometry_path_polygon(self):
        geom = {
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [90.0, 0.0], [90.0, 90.0], [0.0, 90.0]]],
        }
        path = geometry_path(geom)
        self.assertTrue(path.startswith("M"))

    def test_geometry_path_multipolygon(self):
        geom = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[0.0, 0.0], [90.0, 0.0], [90.0, 90.0], [0.0, 90.0]]],
                [[[-90.0, -90.0], [0.0, -90.0], [0.0, 0.0], [-90.0, 0.0]]],
            ],
        }
        path = geometry_path(geom)
        self.assertEqual(path.count("M"), 2)
        self.assertEqual(path.count("Z"), 2)

    def test_geometry_path_empty(self):
        self.assertEqual(geometry_path(None), "")
        self.assertEqual(geometry_path({}), "")
        self.assertEqual(geometry_path({"type": "Point", "coordinates": []}), "")


class TestMapBuildingAndCLI(unittest.TestCase):
    def test_build_map(self):
        features = {
            "features": [
                {
                    "properties": {
                        "ADM0_A3": "USA",
                        "ADMIN": "United States of America",
                        "WIKIDATAID": "Q30",
                        "ISO_A2": "US",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
                        ],
                    },
                },
                {
                    "properties": {
                        "ADM0_A3": "MISSING_GEOM",
                    },
                    "geometry": None,
                },
            ]
        }
        result = build_map(features)
        self.assertEqual(result["schema_version"], "natural-earth-map-paths-v2")
        self.assertEqual(len(result["features"]), 1)

        feature = result["features"][0]
        self.assertEqual(feature["id"], "USA")
        self.assertEqual(feature["label"], "United States of America")
        self.assertEqual(feature["wikidata_id"], "Q30")
        self.assertEqual(feature["iso_a2"], "US")
        self.assertTrue(feature["path"].startswith("M"))

    BODY = b'{"type": "FeatureCollection"}'
    BODY_SHA256 = hashlib.sha256(BODY).hexdigest()

    @mock.patch("kpop_scraping.http_request.urlopen")
    def test_download_features(self, mock_urlopen):
        mock_urlopen.return_value = io.BytesIO(self.BODY)

        result = download_features(self.BODY_SHA256)

        self.assertEqual(result, {"type": "FeatureCollection"})
        request = mock_urlopen.call_args[0][0]
        self.assertIn("kpop-quiz", request.get_header("User-agent"))
        self.assertEqual(mock_urlopen.call_args[1]["timeout"], 30)

    @mock.patch("kpop_scraping.http_request.urlopen")
    def test_download_uses_the_pinned_hash_by_default(self, mock_urlopen):
        mock_urlopen.return_value = io.BytesIO(self.BODY)
        with mock.patch.object(build_map_pilot_map, "SOURCE_SHA256", self.BODY_SHA256):
            self.assertEqual(download_features(), {"type": "FeatureCollection"})

    @mock.patch("kpop_scraping.http_request.urlopen")
    def test_download_with_another_hash_is_refused(self, mock_urlopen):
        mock_urlopen.return_value = io.BytesIO(self.BODY)
        with mock.patch("scripts.build_map_pilot_map.json.loads") as loads:
            with self.assertRaisesRegex(SourceHashError, f"has SHA-256 {self.BODY_SHA256}, expected 0{{64}}"):
                download_features("0" * 64)
        loads.assert_not_called()

    @mock.patch("kpop_scraping.http_request.urlopen")
    def test_download_without_a_pin_is_refused_and_names_the_hash(self, mock_urlopen):
        mock_urlopen.return_value = io.BytesIO(self.BODY)
        with mock.patch.object(build_map_pilot_map, "SOURCE_SHA256", None):
            with self.assertRaisesRegex(SourceHashError, f"not pinned; the downloaded file has SHA-256 {self.BODY_SHA256}"):
                download_features()

    @mock.patch("kpop_scraping.http_request.urlopen")
    def test_main_writes_nothing_when_the_hash_differs(self, mock_urlopen):
        mock_urlopen.return_value = io.BytesIO(self.BODY)
        with TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / "output.json"
            argv = ["script.py", "--output", str(output_path), "--sha256", "0" * 64]
            with mock.patch("sys.argv", argv), mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
                self.assertEqual(main(), 1)
            self.assertFalse(output_path.exists())
            self.assertIn("Natural Earth download refused", stderr.getvalue())

    def test_main_rejects_a_malformed_hash(self):
        with mock.patch("sys.argv", ["script.py", "--sha256", "ABC"]), mock.patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as caught:
                main()
        self.assertEqual(caught.exception.code, 2)

    @mock.patch("scripts.build_map_pilot_map.download_features")
    def test_main(self, mock_download):
        mock_download.return_value = {
            "features": [
                {
                    "properties": {"ADM0_A3": "TST"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
                        ],
                    },
                }
            ]
        }

        with TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / "sub" / "output.json"

            with mock.patch("sys.argv", ["script.py", "--output", str(output_path)]):
                self.assertEqual(main(), 0)

            self.assertTrue(output_path.exists())
            with open(output_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual(data["schema_version"], "natural-earth-map-paths-v2")
            self.assertEqual(len(data["features"]), 1)


if __name__ == "__main__":
    unittest.main()
