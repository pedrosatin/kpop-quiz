"""Seeded lazy orders: every element once, the same order for a seed, no list built."""

import itertools
import random
import tracemalloc
import unittest
from math import comb

from kpop_scraping.lazy_order import (
    combination_at,
    shuffled_combinations,
    shuffled_indices,
)


class ShuffledIndicesTest(unittest.TestCase):
    def test_yields_each_index_once(self):
        for total in (0, 1, 2, 7, 50):
            drawn = list(shuffled_indices(total, random.Random(total)))
            self.assertEqual(sorted(drawn), list(range(total)))

    def test_same_seed_same_order(self):
        first = list(shuffled_indices(100, random.Random(b"seed")))
        second = list(shuffled_indices(100, random.Random(b"seed")))
        other = list(shuffled_indices(100, random.Random(b"other")))
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)

    def test_negative_total_is_refused(self):
        with self.assertRaises(ValueError):
            next(shuffled_indices(-1, random.Random(0)))


class CombinationAtTest(unittest.TestCase):
    def test_ranks_name_every_subset_once(self):
        for n, k in ((10, 3), (9, 4), (5, 5), (5, 0)):
            subsets = [combination_at(rank, n, k) for rank in range(comb(n, k))]
            self.assertEqual(sorted(subsets), list(itertools.combinations(range(n), k)))

    def test_rank_outside_the_range_is_refused(self):
        with self.assertRaises(ValueError):
            combination_at(comb(10, 3), 10, 3)
        with self.assertRaises(ValueError):
            combination_at(-1, 10, 3)


class ShuffledCombinationsTest(unittest.TestCase):
    def test_yields_each_subset_once_in_item_order(self):
        items = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]
        drawn = list(shuffled_combinations(items, 4, random.Random(b"seed")))
        self.assertEqual(len(drawn), comb(9, 4))
        self.assertEqual(set(drawn), set(itertools.combinations(items, 4)))
        self.assertTrue(all(list(quad) == sorted(quad) for quad in drawn))

    def test_fewer_items_than_k_yield_nothing(self):
        self.assertEqual(list(shuffled_combinations(["a", "b", "c"], 4, random.Random(0))), [])

    def test_first_draws_of_a_huge_range_cost_only_the_draws(self):
        # C(300, 4) = 330,791,175 quads, too many to list in 2 GiB.
        items = [f"Q{index}" for index in range(300)]
        tracemalloc.start()
        try:
            tracemalloc.reset_peak()
            quads = shuffled_combinations(items, 4, random.Random(b"seed"))
            drawn = [next(quads) for _ in range(1000)]
            _current, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertEqual(len(set(drawn)), 1000)
        self.assertLess(peak, 2 * 2**20)


if __name__ == "__main__":
    unittest.main()
