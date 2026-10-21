"""Benchmark of the Strands solver by grid size and word count.

Run with ``python -m kpop_scraping.strands_benchmark --database data/kpop.db``.
The database is opened read-only.  Results are printed as Markdown tables;
``docs/strands-benchmark.md`` records one run.

Three measurements:

1. Solver: word lists of 6 to 9 words (spangram included) drawn from the
   real normalized names of the database, with letters adding up to the grid
   area.  Reports how many lists close with a unique grid under the default
   limits, the share of attempts that find a layout and the time per attempt
   and per closed grid.
2. Letter budget: how many roster and decade themes can fill each grid size
   exactly, including sizes below the contract minimum, as input for a
   possible contract change.
3. Real themes: end-to-end generation for each theme that fits the contract
   sizes.
"""

from __future__ import annotations

import argparse
import random
import sqlite3
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

from .quiz_repository import _load_entities, _load_facts
from .strands_generator import (
    DEFAULT_PLACEMENT_ATTEMPTS,
    PlacementStats,
    StrandsGenerationError,
    StrandsWord,
    UniquenessBudgetExceeded,
    assess_theme,
    build_strands_themes,
    choose_word_subset,
    generate_strands_puzzle,
    solve_strands_grid,
)

CONTRACT_SIZES = [(9, 9), (9, 10), (10, 10)]
SMALLER_SIZES = [(6, 8), (7, 7), (7, 8), (8, 8)]


def _name_pool(themes) -> list[str]:
    words = {w.word for theme in themes for w in theme.words}
    words |= {theme.spangram.word for theme in themes if theme.spangram is not None}
    return sorted(words)


def _word_list(pool: list[str], rows: int, cols: int, count: int, rng: random.Random) -> list[str] | None:
    side = min(rows, cols)
    spangrams = [w for w in pool if len(w) >= side]
    for _ in range(50):
        spangram = rng.choice(spangrams)
        others = [StrandsWord(word=w, labels={}) for w in pool if w != spangram]
        chosen = choose_word_subset(
            others, rows * cols - len(spangram), rng, spangram,
            min_count=count - 1, max_count=count - 1, node_budget=5000,
        )
        if chosen is not None:
            return [spangram, *(w.word for w in chosen)]
    return None


def benchmark_solver(pool: list[str], sizes, counts, samples: int, seed: str) -> list[str]:
    lines = [
        "| Grade | Palavras | Listas | Fechadas | Tentativas com layout | ms/tentativa | s/grade fechada (mediana / máx.) | Layouts ambíguos | Listas com unicidade não provada |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for rows, cols in sizes:
        for count in counts:
            rng = random.Random(f"{seed}-{rows}x{cols}-{count}")
            lists = [wl for wl in (_word_list(pool, rows, cols, count, rng) for _ in range(samples)) if wl]
            if not lists:
                lines.append(f"| {rows}×{cols} | {count} | 0 | — | — | — | — | — | — |")
                continue
            closed, attempts, layouts, orientations, ambiguous = 0, 0, 0, 0, 0
            elapsed_total = 0.0
            unproved = 0
            closed_times: list[float] = []
            for words in lists:
                stats = PlacementStats()
                started = time.perf_counter()
                try:
                    solved = solve_strands_grid(words, rows, cols, random.Random(" ".join(words)), stats=stats)
                except UniquenessBudgetExceeded:
                    unproved += 1
                    solved = None
                elapsed = time.perf_counter() - started
                elapsed_total += elapsed
                attempts += stats.attempts
                layouts += stats.layouts
                orientations += stats.orientations
                ambiguous += stats.ambiguous
                if solved is not None:
                    closed += 1
                    closed_times.append(elapsed)
            per_attempt = 1000 * elapsed_total / attempts
            times = (
                f"{statistics.median(closed_times):.2f} / {max(closed_times):.2f}"
                if closed_times else "—"
            )
            lines.append(
                f"| {rows}×{cols} | {count} | {len(lists)} | {closed} ({100 * closed / len(lists):.0f}%) "
                f"| {layouts}/{attempts} ({100 * layouts / attempts:.0f}%) | {per_attempt:.0f} "
                f"| {times} | {ambiguous}/{orientations} | {unproved} |"
            )
    return lines


def benchmark_budget(themes) -> list[str]:
    lines = ["| Grade | Elencos que cabem | Décadas que cabem | Motivos (elencos) |", "|---|---|---|---|"]
    rosters = [t for t in themes if t.category == "has_member"]
    decades = [t for t in themes if t.category == "formed_on"]
    for rows, cols in CONTRACT_SIZES + SMALLER_SIZES:
        reasons: Counter[str] = Counter()
        roster_ok = 0
        for theme in rosters:
            result = assess_theme(theme, rows, cols)
            roster_ok += result.feasible
            if not result.feasible:
                reasons[result.reason or "?"] += 1
        decade_ok = sum(assess_theme(t, rows, cols).feasible for t in decades)
        reason_text = ", ".join(f"{k} {v}" for k, v in sorted(reasons.items()))
        lines.append(
            f"| {rows}×{cols} | {roster_ok}/{len(rosters)} | {decade_ok}/{len(decades)} | {reason_text} |"
        )
    return lines


def benchmark_themes(connection: sqlite3.Connection, themes, seeds: int) -> list[str]:
    lines = ["| Grade | Tema | Sementes | Fechadas | s/grade (mediana / máx.) |", "|---|---|---|---|---|"]
    for rows, cols in CONTRACT_SIZES:
        for theme in themes:
            if not assess_theme(theme, rows, cols).feasible:
                continue
            closed_times: list[float] = []
            for index in range(seeds):
                started = time.perf_counter()
                try:
                    generate_strands_puzzle(
                        connection, seed=f"bench-{index}", theme_filter=theme.theme_id,
                        rows=rows, cols=cols,
                    )
                except StrandsGenerationError:
                    continue
                closed_times.append(time.perf_counter() - started)
            times = (
                f"{statistics.median(closed_times):.2f} / {max(closed_times):.2f}"
                if closed_times else "—"
            )
            lines.append(
                f"| {rows}×{cols} | {theme.theme['en']} | {seeds} | {len(closed_times)} | {times} |"
            )
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=10, help="Word lists per size and count")
    parser.add_argument("--theme-seeds", type=int, default=5, help="Seeds per real theme")
    parser.add_argument("--seed", default="strands-benchmark")
    args = parser.parse_args(argv)
    if not args.database.is_file():
        sys.stderr.write(f"Database does not exist: {args.database}\n")
        return 1

    connection = sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        entities = _load_entities(connection)
        facts, _rejected = _load_facts(connection, entities)
        themes = build_strands_themes(entities, facts)
        pool = _name_pool(themes)
        out = [
            f"Limites: {DEFAULT_PLACEMENT_ATTEMPTS} tentativas por lista; nomes reais: {len(pool)}.",
            "",
            "## Solver",
            "",
            *benchmark_solver(pool, CONTRACT_SIZES, range(6, 10), args.samples, args.seed),
            "",
            "## Orçamento de letras",
            "",
            *benchmark_budget(themes),
            "",
            "## Temas reais",
            "",
            *benchmark_themes(connection, themes, args.theme_seeds),
        ]
    finally:
        connection.close()
    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
