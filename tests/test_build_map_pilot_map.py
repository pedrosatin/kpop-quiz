import unittest

# We need to import the module. Since it's in the scripts folder without __init__.py,
# we can import it using importlib or sys.path, or directly if it's executable via run_module.
# We saw earlier we can just import from scripts.build_map_pilot_map
from scripts.build_map_pilot_map import distance_to_segment


class TestDistanceToSegment(unittest.TestCase):
    def test_distance_when_point_projects_inside_segment(self):
        # Segment from (0, 0) to (10, 0)
        start = (0.0, 0.0)
        end = (10.0, 0.0)
        # Point at (5, 5), nearest point on segment is (5, 0), distance is 5
        self.assertAlmostEqual(distance_to_segment((5.0, 5.0), start, end), 5.0)

    def test_distance_when_point_projects_exactly_on_start(self):
        start = (0.0, 0.0)
        end = (10.0, 0.0)
        # Point at (0, 5), nearest point is (0, 0), distance is 5
        self.assertAlmostEqual(distance_to_segment((0.0, 5.0), start, end), 5.0)

    def test_distance_when_point_projects_exactly_on_end(self):
        start = (0.0, 0.0)
        end = (10.0, 0.0)
        # Point at (10, 5), nearest point is (10, 0), distance is 5
        self.assertAlmostEqual(distance_to_segment((10.0, 5.0), start, end), 5.0)

    def test_distance_when_point_projects_past_start(self):
        start = (0.0, 0.0)
        end = (10.0, 0.0)
        # Point at (-3, 4), nearest point is (0, 0), distance is 5 (3-4-5 triangle)
        self.assertAlmostEqual(distance_to_segment((-3.0, 4.0), start, end), 5.0)

    def test_distance_when_point_projects_past_end(self):
        start = (0.0, 0.0)
        end = (10.0, 0.0)
        # Point at (13, 4), nearest point is (10, 0), distance is 5 (3-4-5 triangle)
        self.assertAlmostEqual(distance_to_segment((13.0, 4.0), start, end), 5.0)

    def test_distance_when_segment_has_zero_length(self):
        start = (5.0, 5.0)
        end = (5.0, 5.0)
        # Point at (8, 9), distance to (5, 5) is 5 (3-4-5 triangle)
        self.assertAlmostEqual(distance_to_segment((8.0, 9.0), start, end), 5.0)

    def test_distance_when_point_is_on_the_segment(self):
        start = (0.0, 0.0)
        end = (10.0, 0.0)
        # Point at (5, 0), nearest point is (5, 0), distance is 0
        self.assertAlmostEqual(distance_to_segment((5.0, 0.0), start, end), 0.0)


if __name__ == "__main__":
    unittest.main()
