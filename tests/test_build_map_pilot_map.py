import unittest

from scripts.build_map_pilot_map import geometry_path, ring_path


class TestBuildMapPilotMap(unittest.TestCase):
    def test_ring_path_empty(self):
        self.assertEqual(ring_path([]), "")

    def test_ring_path_triangle(self):
        # A simple triangle shape
        ring = [[0.0, 0.0], [10.0, 0.0], [0.0, 10.0], [0.0, 0.0]]
        self.assertEqual(
            ring_path(ring), "M600.0,300.0L633.3,300.0L600.0,266.7L600.0,300.0Z"
        )

    def test_ring_path_antimeridian(self):
        # A polygon that crosses the antimeridian line (+180 -> -180 longitude)
        ring = [
            [170, 0],
            [172, 0],
            [175, 0],
            [175, 5],
            [-175, 0],
            [-172, 0],
            [-170, 0],
            [-170, 5],
        ]
        self.assertEqual(
            ring_path(ring),
            "M1166.7,300.0L1183.3,300.0L1183.3,283.3ZM16.7,300.0L33.3,300.0L33.3,283.3Z",
        )

    def test_ring_path_insufficient_points_after_simplify(self):
        # Very small polygon, not enough points after simplification
        ring = [[0.0, 0.0], [0.0001, 0.0], [0.0, 0.0001], [0.0, 0.0]]
        self.assertEqual(ring_path(ring), "")

    def test_geometry_path_none(self):
        self.assertEqual(geometry_path(None), "")

    def test_geometry_path_empty(self):
        self.assertEqual(geometry_path({}), "")

    def test_geometry_path_polygon(self):
        geom = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]]}
        self.assertEqual(
            geometry_path(geom),
            "M600.0,300.0L633.3,300.0L600.0,266.7L600.0,300.0Z",
        )

    def test_geometry_path_multipolygon(self):
        geom = {
            "type": "MultiPolygon",
            "coordinates": [[[[0, 0], [10, 0], [0, 10], [0, 0]]]],
        }
        self.assertEqual(
            geometry_path(geom),
            "M600.0,300.0L633.3,300.0L600.0,266.7L600.0,300.0Z",
        )


if __name__ == "__main__":
    unittest.main()
