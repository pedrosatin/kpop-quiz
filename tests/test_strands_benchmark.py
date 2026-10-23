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

    def test_benchmark_themes(self) -> None:
        from dataclasses import dataclass

        @dataclass
        class DummyTheme:
            theme_id: str
            theme: dict

        theme_ok = DummyTheme(theme_id="ok", theme={"en": "Ok Theme"})
        theme_fail = DummyTheme(theme_id="fail", theme={"en": "Fail Theme"})
        theme_all_fail = DummyTheme(theme_id="all_fail", theme={"en": "All Fail Theme"})

        def dummy_assess(theme, rows, cols):
            from kpop_scraping.strands_generator import ThemeFeasibility

            if theme.theme_id in ("ok", "all_fail"):
                return ThemeFeasibility(
                    theme_id=theme.theme_id, rows=rows, cols=cols, feasible=True
                )
            return ThemeFeasibility(
                theme_id=theme.theme_id,
                rows=rows,
                cols=cols,
                feasible=False,
                reason="Too hard",
            )

        def dummy_generate(connection, seed, theme_filter, rows, cols):
            from kpop_scraping.strands_generator import StrandsGenerationError

            if theme_filter == "all_fail":
                raise StrandsGenerationError("failed generation")
            if seed == "bench-1":  # Make one generation fail to test the except block
                raise StrandsGenerationError("failed generation")
            return None

        with (
            patch("kpop_scraping.strands_benchmark.CONTRACT_SIZES", [(9, 9)]),
            patch(
                "kpop_scraping.strands_benchmark.assess_theme", side_effect=dummy_assess
            ),
            patch(
                "kpop_scraping.strands_benchmark.generate_strands_puzzle",
                side_effect=dummy_generate,
            ) as gen_mock,
            patch(
                "kpop_scraping.strands_benchmark.time.perf_counter",
                side_effect=[1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 9.0, 10.0, 11.0],
            ),
        ):
            from kpop_scraping.strands_benchmark import benchmark_themes

            lines = benchmark_themes(
                None, [theme_fail, theme_ok, theme_all_fail], seeds=3
            )

        self.assertEqual(gen_mock.call_count, 6)
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[2], "| 9×9 | Ok Theme | 3 | 2 | 1.50 / 2.00 |")
        self.assertEqual(lines[3], "| 9×9 | All Fail Theme | 3 | 0 | — |")
