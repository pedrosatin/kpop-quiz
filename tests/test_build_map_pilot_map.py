import unittest

from scripts.build_map_pilot_map import split_antimeridian_ring

class SplitAntimeridianRingTest(unittest.TestCase):
    def test_empty_ring(self):
        self.assertEqual(split_antimeridian_ring([]), [])

    def test_small_non_crossing_ring(self):
        ring = [[0.0, 0.0], [1.0, 1.0]]
        self.assertEqual(split_antimeridian_ring(ring), [])

    def test_valid_non_crossing_ring(self):
        ring = [[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]]
        self.assertEqual(split_antimeridian_ring(ring), [[[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]]])

    def test_crossing_antimeridian_with_small_chunks(self):
        # Starts at longitude 170, crosses antimeridian to -170
        # First chunk: [[170, 0], [175, 0]] (length 2)
        # Second chunk: [[-170, 0], [-175, 0]] (length 2)
        ring = [[170.0, 0.0], [175.0, 0.0], [-170.0, 0.0], [-175.0, 0.0]]
        self.assertEqual(split_antimeridian_ring(ring), [])

    def test_crossing_antimeridian_with_valid_chunks(self):
        # First chunk: [[170, 0], [175, 0], [178, 0]] (length 3)
        # Second chunk: [[-170, 0], [-175, 0], [-178, 0]] (length 3)
        ring = [
            [170.0, 0.0], [175.0, 0.0], [178.0, 0.0],
            [-170.0, 0.0], [-175.0, 0.0], [-178.0, 0.0]
        ]
        self.assertEqual(
            split_antimeridian_ring(ring),
            [
                [[170.0, 0.0], [175.0, 0.0], [178.0, 0.0]],
                [[-170.0, 0.0], [-175.0, 0.0], [-178.0, 0.0]]
            ]
        )

    def test_crossing_antimeridian_mixed_chunk_sizes(self):
        # First chunk: length 2 (invalid)
        # Second chunk: length 3 (valid)
        # Third chunk: length 1 (invalid)
        ring = [
            [170.0, 0.0], [175.0, 0.0],
            [-170.0, 0.0], [-175.0, 0.0], [-178.0, 0.0],
            [170.0, 0.0]
        ]
        self.assertEqual(
            split_antimeridian_ring(ring),
            [
                [[-170.0, 0.0], [-175.0, 0.0], [-178.0, 0.0]]
            ]
        )

if __name__ == "__main__":
    unittest.main()
