import unittest

from scripts.build_map_pilot_map import distance_to_segment, simplify


class TestDistanceToSegment(unittest.TestCase):
    def test_distance_to_segment(self):
        # Point is directly on the segment
        self.assertAlmostEqual(
            distance_to_segment((1.0, 1.0), (0.0, 0.0), (2.0, 2.0)), 0.0
        )
        # Point is off the segment
        self.assertAlmostEqual(
            distance_to_segment((0.0, 1.0), (0.0, 0.0), (0.0, 2.0)), 0.0
        )
        self.assertAlmostEqual(
            distance_to_segment((1.0, 0.0), (0.0, 0.0), (0.0, 2.0)), 1.0
        )
        # Point is beyond the end of the segment
        self.assertAlmostEqual(
            distance_to_segment((0.0, 3.0), (0.0, 0.0), (0.0, 2.0)), 1.0
        )
        # Point is before the start of the segment
        self.assertAlmostEqual(
            distance_to_segment((0.0, -1.0), (0.0, 0.0), (0.0, 2.0)), 1.0
        )
        # Start and end are the same
        self.assertAlmostEqual(
            distance_to_segment((3.0, 4.0), (0.0, 0.0), (0.0, 0.0)), 5.0
        )


class TestSimplify(unittest.TestCase):
    def test_simplify_short_list(self):
        # lists with < 4 points should return themselves unmodified
        points = [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]
        self.assertEqual(simplify(points, 0.5), points)

    def test_simplify_straight_line(self):
        # A straight line should just return start and end
        points = [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0), (3.0, 3.0)]
        self.assertEqual(simplify(points, 0.5), [(0.0, 0.0), (3.0, 3.0)])

    def test_simplify_keeps_point_outside_tolerance(self):
        # Point far from line should be kept
        points = [(0.0, 0.0), (1.0, 1.0), (2.0, 5.0), (3.0, 3.0), (4.0, 0.0)]
        simplified = simplify(points, 1.0)
        self.assertEqual(simplified, [(0.0, 0.0), (2.0, 5.0), (4.0, 0.0)])

    def test_simplify_discards_point_inside_tolerance(self):
        # Intermediate points fall within tolerance, simplifies to start and end
        points = [(0.0, 0.0), (1.0, 0.1), (2.0, -0.1), (3.0, 0.1), (4.0, 0.0)]
        simplified = simplify(points, 0.5)
        self.assertEqual(simplified, [(0.0, 0.0), (4.0, 0.0)])

    def test_simplify_empty(self):
        self.assertEqual(simplify([], 1.0), [])


if __name__ == "__main__":
    unittest.main()
