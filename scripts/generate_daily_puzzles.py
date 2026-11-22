#!/usr/bin/env python3
"""Convenience command-line script to generate and publish daily K-pop puzzles.

Delegates to ``kpop_scraping.daily_puzzles_cli``, which generates the quiz
sessions and the daily boards (grid, connections, name guess, word search,
timeline, group code, crossword and strands) under the partial-publish policy.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kpop_scraping.daily_puzzles_cli import main

if __name__ == "__main__":
    raise SystemExit(main())
