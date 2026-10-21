"""Regression tests for the Strands benchmark caller."""

import unittest
from unittest.mock import patch

from kpop_scraping.strands_benchmark import benchmark_solver
from kpop_scraping.strands_generator import UniquenessBudgetExceeded


class StrandsBenchmarkTests(unittest.TestCase):
    def test_unproved_sample_preserves_work_and_continues(self) -> None:
        def solve(words, rows, cols, rng, *, stats):
            if words == ["FIRST"]:
                stats.attempts = 2
                stats.layouts = 1
                stats.orientations = 2
                stats.ambiguous = 1
                raise UniquenessBudgetExceeded("node budget exceeded")
            stats.attempts = 3
            stats.layouts = 1
            stats.orientations = 1
            return object()

        with (
            patch("kpop_scraping.strands_benchmark._word_list", side_effect=[["FIRST"], ["SECOND"]]),
            patch("kpop_scraping.strands_benchmark.solve_strands_grid", side_effect=solve) as solver,
            patch("kpop_scraping.strands_benchmark.time.perf_counter", side_effect=[10, 12, 20, 23]),
        ):
            lines = benchmark_solver([], [(9, 9)], [6], samples=2, seed="test")

        self.assertEqual(solver.call_count, 2)
        self.assertIn("Listas com unicidade não provada", lines[0])
        self.assertEqual(
            lines[2],
            "| 9×9 | 6 | 2 | 1 (50%) | 2/5 (40%) | 1000 | 3.00 / 3.00 | 1/3 | 1 |",
        )

    def test_unexpected_exception_propagates(self) -> None:
        with (
            patch("kpop_scraping.strands_benchmark._word_list", return_value=["FIRST"]),
            patch("kpop_scraping.strands_benchmark.solve_strands_grid", side_effect=RuntimeError("unexpected")),
        ):
            with self.assertRaisesRegex(RuntimeError, "unexpected"):
                benchmark_solver([], [(9, 9)], [6], samples=1, seed="test")
