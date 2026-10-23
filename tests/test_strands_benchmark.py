"""Regression tests for the Strands benchmark caller."""

import unittest
from unittest.mock import patch

from kpop_scraping.strands_benchmark import benchmark_solver, benchmark_budget
from kpop_scraping.strands_generator import UniquenessBudgetExceeded, ThemeFeasibility
from unittest.mock import MagicMock


class StrandsBenchmarkTests(unittest.TestCase):
    def test_benchmark_budget(self) -> None:
        theme1 = MagicMock(category="has_member")
        theme2 = MagicMock(category="has_member")
        theme3 = MagicMock(category="formed_on")

        def mock_assess(theme, rows, cols):
            if theme == theme1:
                return ThemeFeasibility(
                    theme_id="1", rows=rows, cols=cols, feasible=True
                )
            elif theme == theme2:
                return ThemeFeasibility(
                    theme_id="2",
                    rows=rows,
                    cols=cols,
                    feasible=False,
                    reason="too long",
                )
            else:
                return ThemeFeasibility(
                    theme_id="3", rows=rows, cols=cols, feasible=True
                )

        with (
            patch(
                "kpop_scraping.strands_benchmark.assess_theme", side_effect=mock_assess
            ),
            patch("kpop_scraping.strands_benchmark.CONTRACT_SIZES", [(9, 9)]),
            patch("kpop_scraping.strands_benchmark.SMALLER_SIZES", []),
        ):
            lines = benchmark_budget([theme1, theme2, theme3])

        self.assertEqual(len(lines), 3)
        self.assertEqual(
            lines[0],
            "| Grade | Elencos que cabem | Décadas que cabem | Motivos (elencos) |",
        )
        self.assertEqual(lines[1], "|---|---|---|---|")
        self.assertEqual(lines[2], "| 9×9 | 1/2 | 1/1 | too long 1 |")

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
            patch(
                "kpop_scraping.strands_benchmark._word_list",
                side_effect=[["FIRST"], ["SECOND"]],
            ),
            patch(
                "kpop_scraping.strands_benchmark.solve_strands_grid", side_effect=solve
            ) as solver,
            patch(
                "kpop_scraping.strands_benchmark.time.perf_counter",
                side_effect=[10, 12, 20, 23],
            ),
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
            patch(
                "kpop_scraping.strands_benchmark.solve_strands_grid",
                side_effect=RuntimeError("unexpected"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "unexpected"):
                benchmark_solver([], [(9, 9)], [6], samples=1, seed="test")
