"""Deterministic generation of Strands puzzles from audited facts.

A Strands grid is fully partitioned into word paths (see ``strands_schema``).
Generation runs in three separated steps:

1. Theme selection.  Themes come from ``extract_viable_themes`` of the word
   search generator, restricted to group rosters and the 1990s, 2000s and
   2010s formation decades.  A roster uses the group name as an ``entity``
   spangram; a decade uses a fixed ``theme`` spangram.  A word subset is drawn
   whose letters add up to exactly ``rows * cols``.
2. Placement.  Only word lengths matter here.  A backtracking "word maze"
   solver lays the spangram from one side to the opposite side, then grows
   each remaining path from the most constrained empty cell, checking after
   each path that the empty regions can still be split among the remaining
   lengths.  Diagonal steps that would cross another diagonal step are never
   taken.
3. Letters and uniqueness.  Words are written along the paths in a random
   orientation, then ``count_strands_solutions`` enumerates every path of
   every theme word in the finished grid (prefix pruning) and counts the
   ways to pick one path per word without sharing cells.  The grid is
   accepted only when that count is exactly one.

Uniqueness is defined over the puzzle's own word list: given the theme words
and the spangram, exactly one assignment of one path per word exists whose
paths are pairwise disjoint (and therefore cover the grid, since the word
lengths add up to the grid area).  Two assignments that differ only in the
order of cells of one word count as different.  The crossing rule is not
applied to alternative assignments, so a crossing alternative still makes the
grid ambiguous.  Words outside the theme are out of scope: the grid may spell
other names or dictionary words, and the game must accept only theme words.

Randomness comes from one ``random.Random`` seeded with the SHA-256 of the
seed string.  Search effort is bounded by node budgets, so the same database,
seed, date and dimensions produce the same puzzle on any machine.  A
wall-clock limit exists only as a safety net for the daily CI run; reaching
it raises ``StrandsGenerationError`` instead of returning a different grid.
"""

from __future__ import annotations

import hashlib
import random
import sqlite3
import time
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterable, Sequence

from .quiz_models import Entity, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .strands_schema import (
    STRANDS_MAX_SIDE,
    STRANDS_MAX_WORDS,
    STRANDS_MIN_SIDE,
    STRANDS_MIN_WORD_LENGTH,
    STRANDS_MIN_WORDS,
    STRANDS_SCHEMA_VERSION,
    compute_strands_puzzle_id,
    validate_strands_puzzle,
)
from .word_search_generator import (
    ThemeDefinition,
    _serialize_evidence,
    extract_viable_themes,
)
from .word_search_schema import normalize_word

# Fixed by docs/strands-benchmark.md.
STRANDS_DEFAULT_ROWS = 9
STRANDS_DEFAULT_COLS = 9

STRANDS_DECADES = (1990, 2000, 2010)

# Decade spangrams are theme expressions without a factual claim of their
# own.  The grid uses the pt-BR spelling; the English label is a translation.
DECADE_SPANGRAMS: dict[int, tuple[str, dict[str, str]]] = {
    1990: ("ANOSNOVENTA", {"pt-BR": "Anos noventa", "en": "The 1990s"}),
    2000: ("ANOSDOISMIL", {"pt-BR": "Anos dois mil", "en": "The 2000s"}),
    2010: ("ANOSDOISMILEDEZ", {"pt-BR": "Anos dois mil e dez", "en": "The 2010s"}),
}

# Search limits.  Node budgets keep results reproducible; the deadline only
# turns a pathological run into an explicit failure.
DEFAULT_PLACEMENT_NODE_BUDGET = 4000
DEFAULT_PLACEMENT_ATTEMPTS = 60
DEFAULT_ORIENTATIONS_PER_LAYOUT = 6
DEFAULT_SUBSETS_PER_THEME = 4
DEFAULT_TIME_LIMIT_SECONDS = 30.0
# A word with more paths than this in a finished grid is too ambiguous to
# prove anything about; the grid is rejected.
MAX_PATHS_PER_WORD = 2000
DEFAULT_UNIQUENESS_NODE_BUDGET = 100000

Path = list[int]

DISCARD_SHORT_NAME = "short_name"
DISCARD_NON_LATIN_NAME = "non_latin_name"
DISCARD_NO_EVIDENCE = "no_evidence"
DISCARD_DUPLICATE_WORD = "duplicate_word"
DISCARD_OVERLAPS_SPANGRAM = "overlaps_spangram"


class StrandsGenerationError(ValueError):
    """Raised when no valid Strands puzzle can be produced within limits."""


def _check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.monotonic() >= deadline:
        raise StrandsGenerationError("Strands generation exceeded its time limit")


class UniquenessBudgetExceeded(StrandsGenerationError):
    """Enumeration was interrupted; uniqueness has not been proved."""


@dataclass
class _UniquenessBudget:
    remaining: int
    deadline: float | None

    def tick(self) -> None:
        _check_deadline(self.deadline)
        self.remaining -= 1
        if self.remaining < 0:
            raise UniquenessBudgetExceeded(
                "Strands uniqueness not proved: node budget exceeded"
            )


@dataclass(frozen=True)
class StrandsWord:
    word: str
    labels: dict[str, str]
    entity_id: str | None = None
    canonical_name: str | None = None
    evidence: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class DiscardedName:
    entity_id: str
    name: str
    reason: str


@dataclass(frozen=True)
class StrandsTheme:
    theme_id: str
    category: str
    target_id: str
    theme: dict[str, str]
    theme_description: dict[str, str] | None
    spangram: StrandsWord | None
    spangram_kind: str
    words: tuple[StrandsWord, ...]
    discarded: tuple[DiscardedName, ...] = ()
    spangram_problem: str | None = None


@dataclass
class ThemeFeasibility:
    theme_id: str
    rows: int
    cols: int
    feasible: bool
    reason: str | None = None
    letters_available: int = 0


@dataclass
class PlacementStats:
    nodes: int = 0
    attempts: int = 0
    layouts: int = 0
    orientations: int = 0
    ambiguous: int = 0
    events: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Names and themes
# ---------------------------------------------------------------------------


def has_non_latin_letters(name: str) -> bool:
    """Return True when ``name`` holds a letter outside basic Latin A-Z.

    Accented Latin letters decompose to A-Z and are accepted.  Hangul, kana,
    CJK or Cyrillic letters would vanish during normalization and change the
    name, so those names are discarded instead of truncated.
    """
    for char in name:
        if not char.isalpha():
            continue
        base = unicodedata.normalize("NFKD", char)[:1].upper()
        if not ("A" <= base <= "Z"):
            return True
    return False


def classify_name(name: str) -> tuple[str | None, str | None]:
    """Return ``(word, None)`` for a usable name or ``(None, reason)``."""
    if has_non_latin_letters(name):
        return None, DISCARD_NON_LATIN_NAME
    word = normalize_word(name)
    if len(word) < STRANDS_MIN_WORD_LENGTH:
        return None, DISCARD_SHORT_NAME
    return word, None


def _theme_entries(
    theme: ThemeDefinition, facts: Sequence[Fact]
) -> tuple[list[tuple[Entity, list[Fact]]], Entity | None]:
    """Return the raw theme members and, for rosters, the group entity."""
    entries: dict[str, tuple[Entity, list[Fact]]] = {}
    group: Entity | None = None
    for fact in facts:
        if theme.category == "has_member":
            if fact.predicate == "has_member" and fact.value_entity:
                grp, member = fact.subject, fact.value_entity
            elif fact.predicate == "member_of" and fact.value_entity:
                grp, member = fact.value_entity, fact.subject
            else:
                continue
            if grp.wikidata_id != theme.target_id:
                continue
            group = grp
        elif theme.category == "formed_on":
            if fact.predicate != "formed_on" or not fact.value_time:
                continue
            year = fact.value_time.lstrip("+-")[:4]
            if not year.isdigit() or str(int(year) // 10 * 10) != theme.target_id:
                continue
            member = fact.subject
        else:
            continue
        entry = entries.setdefault(member.wikidata_id, (member, []))
        entry[1].append(fact)
    return [entries[key] for key in sorted(entries)], group


def _overlaps(a: str, b: str) -> bool:
    return a in b or b in a


def _build_theme(theme: ThemeDefinition, facts: Sequence[Fact]) -> StrandsTheme:
    entries, group = _theme_entries(theme, facts)

    spangram: StrandsWord | None = None
    spangram_problem: str | None = None
    if theme.category == "has_member":
        spangram_kind = "entity"
        if group is None:
            spangram_problem = "group_not_found"
        else:
            word, reason = classify_name(group.canonical_name)
            group_evidence = _serialize_evidence(
                ev
                for _member, member_facts in entries
                for f in member_facts
                for ev in f.evidence
            )
            if word is None:
                spangram_problem = f"group_{reason}"
            elif not group_evidence:
                spangram_problem = "group_no_evidence"
            else:
                spangram = StrandsWord(
                    word=word,
                    labels={"pt-BR": group.canonical_name, "en": group.canonical_name},
                    entity_id=group.wikidata_id,
                    canonical_name=group.canonical_name,
                    evidence=tuple(group_evidence),
                )
    else:
        spangram_kind = "theme"
        word, labels = DECADE_SPANGRAMS[int(theme.target_id)]
        spangram = StrandsWord(word=word, labels=dict(labels))

    kept: dict[str, StrandsWord] = {}
    discarded: list[DiscardedName] = []
    candidate_ids = {cand.id for cand in theme.candidates}
    for cand in sorted(theme.candidates, key=lambda c: (c.word, c.id)):
        name = cand.labels["en"]
        if has_non_latin_letters(name):
            discarded.append(DiscardedName(cand.id, name, DISCARD_NON_LATIN_NAME))
        elif spangram is not None and _overlaps(cand.word, spangram.word):
            discarded.append(DiscardedName(cand.id, name, DISCARD_OVERLAPS_SPANGRAM))
        else:
            kept[cand.id] = StrandsWord(
                word=cand.word,
                labels=dict(cand.labels),
                entity_id=cand.id,
                canonical_name=cand.canonical_name,
                evidence=tuple(cand.evidence),
            )
    # Explain the members that ``extract_viable_themes`` dropped silently.
    seen_words = {w.word for w in kept.values()}
    for entity, entity_facts in entries:
        if entity.wikidata_id in candidate_ids:
            continue
        word, reason = classify_name(entity.canonical_name)
        if reason is None:
            if not any(f.evidence for f in entity_facts):
                reason = DISCARD_NO_EVIDENCE
            elif word in seen_words:
                reason = DISCARD_DUPLICATE_WORD
            else:
                continue
        discarded.append(
            DiscardedName(entity.wikidata_id, entity.canonical_name, reason)
        )

    return StrandsTheme(
        theme_id=theme.theme_id,
        category=theme.category,
        target_id=theme.target_id,
        theme=dict(theme.theme),
        theme_description=(
            {
                "pt-BR": "Integrantes atuais e antigos documentados do grupo.",
                "en": "Documented current and former group members.",
            }
            if theme.category == "has_member"
            else dict(theme.theme_description) if theme.theme_description else None
        ),
        spangram=spangram,
        spangram_kind=spangram_kind,
        words=tuple(sorted(kept.values(), key=lambda w: (w.word, w.entity_id or ""))),
        discarded=tuple(sorted(discarded, key=lambda d: (d.reason, d.entity_id))),
        spangram_problem=spangram_problem,
    )


def build_strands_themes(
    entities: dict[int, Entity], facts: list[Fact]
) -> list[StrandsTheme]:
    """Return roster and decade themes with spangrams and discard reasons.

    ``extract_viable_themes`` keeps names of 3 to 16 letters and audited
    evidence; Strands paths bend, so the grid side does not cap word length.
    """
    viable = extract_viable_themes(
        entities, facts, rows=16, cols=16, min_candidates=STRANDS_MIN_WORDS - 1
    )
    themes: list[StrandsTheme] = []
    for theme in viable:
        if theme.category == "has_member":
            themes.append(_build_theme(theme, facts))
        elif theme.category == "formed_on" and int(theme.target_id) in STRANDS_DECADES:
            themes.append(_build_theme(theme, facts))
    themes.sort(key=lambda t: (t.category, t.theme_id))
    return themes


def _subset_sums_possible(
    lengths: Sequence[int],
    target: int,
    min_count: int,
    max_count: int,
    deadline: float | None = None,
) -> bool:
    reachable: set[tuple[int, int]] = {(0, 0)}
    for length in lengths:
        _check_deadline(deadline)
        reachable |= {
            (count + 1, total + length)
            for count, total in reachable
            if count < max_count and total + length <= target
        }
    return any(count >= min_count and total == target for count, total in reachable)


def assess_theme(
    theme: StrandsTheme,
    rows: int,
    cols: int,
    deadline: float | None = None,
) -> ThemeFeasibility:
    """Check, before any search, whether the theme can fill a grid exactly."""
    area = rows * cols
    letters = sum(len(w.word) for w in theme.words)
    result = ThemeFeasibility(theme.theme_id, rows, cols, False, None, letters)
    if theme.spangram is None:
        result.reason = theme.spangram_problem or "no_spangram"
        return result
    if len(theme.spangram.word) < min(rows, cols):
        result.reason = "spangram_too_short"
        return result
    if len(theme.words) < STRANDS_MIN_WORDS - 1:
        result.reason = "too_few_words"
        return result
    target = area - len(theme.spangram.word)
    if not _subset_sums_possible(
        [len(w.word) for w in theme.words],
        target,
        STRANDS_MIN_WORDS - 1,
        STRANDS_MAX_WORDS - 1,
        deadline,
    ):
        best = sum(
            sorted((len(w.word) for w in theme.words), reverse=True)[
                : STRANDS_MAX_WORDS - 1
            ]
        )
        result.reason = (
            "not_enough_letters" if best < target else "no_exact_letter_count"
        )
        return result
    result.feasible = True
    return result


def choose_word_subset(
    words: Sequence[StrandsWord],
    target: int,
    rng: random.Random,
    spangram_word: str,
    min_count: int = STRANDS_MIN_WORDS - 1,
    max_count: int = STRANDS_MAX_WORDS - 1,
    node_budget: int = 20000,
    deadline: float | None = None,
) -> list[StrandsWord] | None:
    """Draw words whose lengths add up to ``target``.

    No chosen word may contain another one (or the spangram), because the
    shorter word would then have extra paths inside the longer one.
    """
    pool = list(words)
    rng.shuffle(pool)
    chosen: list[StrandsWord] = []
    nodes = [0]

    def search(start: int, total: int) -> bool:
        _check_deadline(deadline)
        nodes[0] += 1
        if nodes[0] > node_budget:
            return False
        if total == target and len(chosen) >= min_count:
            return True
        if len(chosen) == max_count or total >= target:
            return False
        for idx in range(start, len(pool)):
            _check_deadline(deadline)
            cand = pool[idx]
            if total + len(cand.word) > target:
                continue
            if _overlaps(cand.word, spangram_word) or any(
                _overlaps(cand.word, other.word) for other in chosen
            ):
                continue
            chosen.append(cand)
            if search(idx + 1, total + len(cand.word)):
                return True
            chosen.pop()
        return False

    return list(chosen) if search(0, 0) else None


# ---------------------------------------------------------------------------
# Grid geometry
# ---------------------------------------------------------------------------


class _Geometry:
    def __init__(self, rows: int, cols: int) -> None:
        self.rows = rows
        self.cols = cols
        self.size = rows * cols
        self.neighbors: list[list[int]] = []
        for idx in range(self.size):
            r, c = divmod(idx, cols)
            cells = []
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        cells.append(nr * cols + nc)
            self.neighbors.append(cells)

    def crossing_key(self, a: int, b: int) -> int | None:
        """Return the key of the diagonal that a diagonal step a-b would cross."""
        ar, ac = divmod(a, self.cols)
        br, bc = divmod(b, self.cols)
        if ar == br or ac == bc:
            return None
        return self.edge_key(ar * self.cols + bc, br * self.cols + ac)

    def edge_key(self, a: int, b: int) -> int:
        return min(a, b) * self.size + max(a, b)


def _components(geometry: _Geometry, owner: list[int]) -> list[int]:
    seen = [False] * geometry.size
    sizes: list[int] = []
    for start in range(geometry.size):
        if owner[start] != -1 or seen[start]:
            continue
        seen[start] = True
        stack = [start]
        count = 0
        while stack:
            cell = stack.pop()
            count += 1
            for nxt in geometry.neighbors[cell]:
                if owner[nxt] == -1 and not seen[nxt]:
                    seen[nxt] = True
                    stack.append(nxt)
        sizes.append(count)
    return sizes


def _can_split(
    sizes: list[int], lengths: list[int], deadline: float | None = None
) -> bool:
    """Return True when the lengths can be grouped to fill each region exactly."""
    if not sizes:
        return not lengths
    if sum(sizes) != sum(lengths):
        return False
    if lengths and min(sizes) < min(lengths):
        return False
    sizes = sorted(sizes)
    lengths = sorted(lengths, reverse=True)

    def fill(region: int, remaining: int, used: int, start: int) -> bool:
        _check_deadline(deadline)
        if remaining == 0:
            if region + 1 == len(sizes):
                return used == (1 << len(lengths)) - 1
            return fill(region + 1, sizes[region + 1], used, 0)
        previous = -1
        for idx in range(start, len(lengths)):
            if (
                used & (1 << idx)
                or lengths[idx] > remaining
                or lengths[idx] == previous
            ):
                continue
            previous = lengths[idx]
            if fill(region, remaining - lengths[idx], used | (1 << idx), idx + 1):
                return True
        return False

    return fill(0, sizes[0], 0, 0)


def spans_opposite_sides_idx(path: Sequence[int], rows: int, cols: int) -> bool:
    rows_seen = {cell // cols for cell in path}
    cols_seen = {cell % cols for cell in path}
    return (0 in rows_seen and rows - 1 in rows_seen) or (
        0 in cols_seen and cols - 1 in cols_seen
    )


# ---------------------------------------------------------------------------
# Placement (lengths only)
# ---------------------------------------------------------------------------


class _BudgetExceeded(Exception):
    pass


class _PathPlacer:
    def __init__(
        self,
        lengths: Sequence[int],
        rows: int,
        cols: int,
        rng: random.Random,
        node_budget: int,
        deadline: float | None,
    ) -> None:
        self.lengths = lengths
        self.rows = rows
        self.cols = cols
        self.rng = rng
        self.node_budget = node_budget
        self.deadline = deadline

        self.geometry = _Geometry(rows, cols)
        if sum(lengths) != self.geometry.size:
            raise ValueError("word lengths must add up to the grid area")
        self.owner = [-1] * self.geometry.size
        self.diagonals: set[int] = set()
        self.result: list[Path | None] = [None] * len(lengths)
        self.nodes = 0

    def tick(self) -> None:
        _check_deadline(self.deadline)
        self.nodes += 1
        if self.nodes > self.node_budget:
            raise _BudgetExceeded

    def free_degree(self, cell: int) -> int:
        return sum(1 for nxt in self.geometry.neighbors[cell] if self.owner[nxt] == -1)

    def step_allowed(self, a: int, b: int) -> bool:
        key = self.geometry.crossing_key(a, b)
        return key is None or key not in self.diagonals

    def isolates_cell(self, previous: int, head: int, remaining: int) -> bool:
        """Return True when the last step left an empty cell no path can reach.

        An empty cell without empty neighbours can only be the last cell of
        the path being grown, and only when it touches the head and exactly
        one letter is left.
        """
        stranded = 0
        for cell in set(self.geometry.neighbors[previous]) | set(
            self.geometry.neighbors[head]
        ):
            if self.owner[cell] != -1 or self.free_degree(cell):
                continue
            if (
                remaining == 1
                and cell in self.geometry.neighbors[head]
                and stranded == 0
            ):
                stranded = 1
                continue
            return True
        return False

    def remaining_lengths(self) -> list[int]:
        return [
            self.lengths[i] for i in range(len(self.lengths)) if self.result[i] is None
        ]

    def grow(
        self,
        path: Path,
        length: int,
        index: int,
        accept: Callable[[Path], bool],
        prune: Callable[[Path], bool],
        warnsdorff: bool,
    ) -> bool:
        self.tick()
        if len(path) == length:
            return accept(path)
        head = path[-1]
        options = [
            nxt
            for nxt in self.geometry.neighbors[head]
            if self.owner[nxt] == -1 and self.step_allowed(head, nxt)
        ]
        self.rng.shuffle(options)
        if warnsdorff:
            options.sort(key=self.free_degree)
        for nxt in options:
            path.append(nxt)
            self.owner[nxt] = index
            key = None
            if self.geometry.crossing_key(head, nxt) is not None:
                key = self.geometry.edge_key(head, nxt)
                self.diagonals.add(key)
            ok = (
                not self.isolates_cell(head, nxt, length - len(path))
                and not prune(path)
                and self.grow(path, length, index, accept, prune, warnsdorff)
            )
            if ok:
                return True
            if key is not None:
                self.diagonals.discard(key)
            self.owner[nxt] = -1
            path.pop()
        return False

    def regions_ok(self) -> bool:
        return _can_split(
            _components(self.geometry, self.owner),
            self.remaining_lengths(),
            self.deadline,
        )

    def place_next(self) -> bool:
        pending = [i for i in range(len(self.lengths)) if self.result[i] is None]
        if not pending:
            return True
        empty = [cell for cell in range(self.geometry.size) if self.owner[cell] == -1]
        degrees = {cell: self.free_degree(cell) for cell in empty}
        lowest = min(degrees.values())
        start = self.rng.choice([cell for cell in empty if degrees[cell] == lowest])
        tried_lengths: set[int] = set()
        order = list(pending)
        self.rng.shuffle(order)
        for index in order:
            length = self.lengths[index]
            if length in tried_lengths:
                continue
            tried_lengths.add(length)

            def accept(path: Path, index: int = index) -> bool:
                self.result[index] = list(path)
                if self.regions_ok() and self.place_next():
                    return True
                self.result[index] = None
                return False

            self.owner[start] = index
            if self.grow([start], length, index, accept, lambda _p: False, True):
                return True
            self.owner[start] = -1
        return False

    def spangram_far_side(self, path: Path, axis: str) -> int:
        if axis == "horizontal":
            return max(cell % self.cols for cell in path)
        return max(cell // self.cols for cell in path)

    def place(self) -> list[Path] | None:
        spangram_length = self.lengths[0]
        axes = []
        if spangram_length >= self.cols:
            axes.append("horizontal")
        if spangram_length >= self.rows:
            axes.append("vertical")
        if not axes:
            raise ValueError("spangram is too short to touch two opposite sides")

        try:
            for _ in range(4):
                axis = self.rng.choice(axes)
                span = self.cols if axis == "horizontal" else self.rows
                other = self.rows if axis == "horizontal" else self.cols
                line = self.rng.randrange(other)
                start = line * self.cols if axis == "horizontal" else line

                def sp_prune(path: Path, axis: str = axis, span: int = span) -> bool:
                    reached = self.spangram_far_side(path, axis)
                    return (span - 1 - reached) > (spangram_length - len(path))

                def sp_accept(path: Path, axis: str = axis, span: int = span) -> bool:
                    if self.spangram_far_side(path, axis) != span - 1:
                        return False
                    self.result[0] = list(path)
                    if self.regions_ok() and self.place_next():
                        return True
                    self.result[0] = None
                    return False

                self.owner[start] = 0
                if self.grow([start], spangram_length, 0, sp_accept, sp_prune, False):
                    break
                self.owner[start] = -1
            else:
                return None
        except _BudgetExceeded:
            return None

        paths = [p for p in self.result if p is not None]
        if len(paths) != len(self.lengths):
            return None
        _check_deadline(self.deadline)
        return paths


def place_strands_paths(
    lengths: Sequence[int],
    rows: int,
    cols: int,
    rng: random.Random,
    node_budget: int = DEFAULT_PLACEMENT_NODE_BUDGET,
    stats: PlacementStats | None = None,
    deadline: float | None = None,
) -> list[Path] | None:
    """Partition the grid into paths with the given lengths.

    ``lengths[0]`` is the spangram and must touch two opposite sides.  The
    other paths follow in the returned order of ``lengths``.  Returns ``None``
    when the node budget runs out before a partition is found.
    """
    placer = _PathPlacer(lengths, rows, cols, rng, node_budget, deadline)
    paths = placer.place()
    if stats is not None:
        stats.nodes += placer.nodes
    return paths


# ---------------------------------------------------------------------------
# Uniqueness
# ---------------------------------------------------------------------------


class AmbiguityLimitExceeded(Exception):
    """A word has too many paths in the grid to enumerate."""


def find_word_paths(
    grid: Sequence[Sequence[str]],
    word: str,
    limit: int = MAX_PATHS_PER_WORD,
    *,
    node_budget: int = DEFAULT_UNIQUENESS_NODE_BUDGET,
    deadline: float | None = None,
    _budget: _UniquenessBudget | None = None,
) -> list[tuple[int, ...]]:
    """Return every 8-neighbour path without reused cells spelling ``word``.

    The search extends a path only while its letters are a prefix of
    ``word``, so its cost follows the number of matching prefixes, not the
    number of possible paths in the grid. Matching prefixes consume the
    node budget even when no complete word path exists. Exhaustion raises
    ``UniquenessBudgetExceeded`` without returning partial results.
    """
    _check_deadline(deadline)
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    geometry = _Geometry(rows, cols)
    letters = [grid[r][c] for r in range(rows) for c in range(cols)]
    found: list[tuple[int, ...]] = []
    path: list[int] = []
    on_path = [False] * geometry.size

    budget = (
        _budget if _budget is not None else _UniquenessBudget(node_budget, deadline)
    )

    def extend(cell: int) -> None:
        budget.tick()
        path.append(cell)
        on_path[cell] = True
        if len(path) == len(word):
            found.append(tuple(path))
            if len(found) > limit:
                raise AmbiguityLimitExceeded(word)
        else:
            letter = word[len(path)]
            for nxt in geometry.neighbors[cell]:
                if not on_path[nxt] and letters[nxt] == letter:
                    extend(nxt)
        on_path[cell] = False
        path.pop()

    for cell in range(geometry.size):
        if letters[cell] == word[0]:
            extend(cell)
    _check_deadline(deadline)
    return found


def enumerate_strands_solutions(
    grid: Sequence[Sequence[str]],
    words: Sequence[str],
    limit: int = 2,
    path_limit: int = MAX_PATHS_PER_WORD,
    *,
    node_budget: int = DEFAULT_UNIQUENESS_NODE_BUDGET,
    deadline: float | None = None,
) -> list[list[tuple[int, ...]]]:
    """Return up to ``limit`` assignments of one disjoint path per word.

    Paths use flat cell indexes (``row * cols + col``).  The search picks the
    word with the fewest paths still compatible with the cells already taken
    and stops as soon as ``limit`` assignments are found.  Raises
    ``AmbiguityLimitExceeded`` when a word has more than ``path_limit`` paths.
    Prefix expansions, assignment states and compatibility checks share one
    deterministic node budget. Exhaustion raises ``UniquenessBudgetExceeded``;
    neither exhaustion nor a deadline returns a partial solution count.
    """
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    full = (1 << (rows * cols)) - 1
    budget = _UniquenessBudget(node_budget, deadline)
    options: list[list[tuple[int, tuple[int, ...]]]] = []
    for word in words:
        paths = find_word_paths(
            grid, word, path_limit, deadline=deadline, _budget=budget
        )
        options.append([(sum(1 << cell for cell in p), p) for p in paths])

    solutions: list[list[tuple[int, ...]]] = []
    chosen: dict[int, tuple[int, ...]] = {}
    total_letters = sum(len(w) for w in words)

    def search(used: int, pending: tuple[int, ...]) -> None:
        budget.tick()
        if len(solutions) >= limit:
            return
        if not pending:
            solutions.append([chosen[i] for i in range(len(words))])
            return
        best_index = -1
        best: list[tuple[int, tuple[int, ...]]] = []
        reach = 0
        for index in pending:
            compatible = []
            for item in options[index]:
                budget.tick()
                if not item[0] & used:
                    compatible.append(item)
            if not compatible:
                return
            for mask, _p in compatible:
                reach |= mask
            if best_index == -1 or len(compatible) < len(best):
                best_index, best = index, compatible
        if total_letters == rows * cols and (reach | used) != full:
            return
        rest = tuple(i for i in pending if i != best_index)
        for mask, path in best:
            chosen[best_index] = path
            search(used | mask, rest)
            if len(solutions) >= limit:
                return
        chosen.pop(best_index, None)

    search(0, tuple(range(len(words))))
    _check_deadline(deadline)
    return solutions


def count_strands_solutions(
    grid: Sequence[Sequence[str]],
    words: Sequence[str],
    limit: int = 2,
    *,
    node_budget: int = DEFAULT_UNIQUENESS_NODE_BUDGET,
    deadline: float | None = None,
) -> int:
    """Count disjoint path assignments for ``words``, stopping at ``limit``."""
    return len(
        enumerate_strands_solutions(
            grid, words, limit=limit, node_budget=node_budget, deadline=deadline
        )
    )


def verify_strands_uniqueness(
    payload: dict[str, Any],
    *,
    node_budget: int = DEFAULT_UNIQUENESS_NODE_BUDGET,
    deadline: float | None = None,
) -> None:
    """Raise ValueError unless the puzzle's word list has exactly one solution.

    The single solution must also be the one the payload declares.
    """
    grid = payload["grid"]
    cols = len(grid[0])
    words = [entry["word"] for entry in payload["words"]]
    try:
        solutions = enumerate_strands_solutions(
            grid, words, limit=2, node_budget=node_budget, deadline=deadline
        )
    except AmbiguityLimitExceeded as exc:
        raise ValueError(
            f"Strands uniqueness not proved: word {exc.args[0]} has more than "
            f"{MAX_PATHS_PER_WORD} paths"
        ) from exc
    if len(solutions) != 1:
        raise ValueError(
            f"Strands puzzle must have exactly one solution for its words, found "
            f"{'at least 2' if len(solutions) > 1 else 0}"
        )
    declared = [
        tuple(r * cols + c for r, c in entry["cells"]) for entry in payload["words"]
    ]
    _check_deadline(deadline)
    if solutions[0] != declared:
        raise ValueError(
            "Strands puzzle's only solution differs from the declared cells"
        )


# ---------------------------------------------------------------------------
# Puzzle assembly
# ---------------------------------------------------------------------------


@dataclass
class SolvedGrid:
    grid: list[list[str]]
    paths: list[Path]
    words: list[str]


def solve_strands_grid(
    words: Sequence[str],
    rows: int,
    cols: int,
    rng: random.Random,
    attempts: int = DEFAULT_PLACEMENT_ATTEMPTS,
    node_budget: int = DEFAULT_PLACEMENT_NODE_BUDGET,
    orientations: int = DEFAULT_ORIENTATIONS_PER_LAYOUT,
    deadline: float | None = None,
    stats: PlacementStats | None = None,
    uniqueness_node_budget: int = DEFAULT_UNIQUENESS_NODE_BUDGET,
) -> SolvedGrid | None:
    """Lay out ``words`` (spangram first) and return a grid with one solution."""
    stats = stats if stats is not None else PlacementStats()
    lengths = [len(w) for w in words]
    for _ in range(attempts):
        _check_deadline(deadline)
        stats.attempts += 1
        paths = place_strands_paths(
            lengths, rows, cols, rng, node_budget, stats, deadline=deadline
        )
        if paths is None:
            continue
        stats.layouts += 1
        by_length: dict[int, list[int]] = defaultdict(list)
        for idx, length in enumerate(lengths[1:], start=1):
            by_length[length].append(idx)
        for _ in range(orientations):
            _check_deadline(deadline)
            stats.orientations += 1
            # Words of equal length may swap paths; each word picks a direction.
            assignment: list[Path] = [list(paths[0])] + [[] for _ in lengths[1:]]
            for indexes in by_length.values():
                targets = list(indexes)
                rng.shuffle(targets)
                for word_idx, path_idx in zip(indexes, targets):
                    assignment[word_idx] = list(paths[path_idx])
            for path in assignment:
                if rng.random() < 0.5:
                    path.reverse()
            letters = [""] * (rows * cols)
            for word, path in zip(words, assignment):
                for letter, cell in zip(word, path):
                    letters[cell] = letter
            grid = [letters[r * cols : (r + 1) * cols] for r in range(rows)]
            try:
                count = count_strands_solutions(
                    grid,
                    words,
                    limit=2,
                    node_budget=uniqueness_node_budget,
                    deadline=deadline,
                )
            except AmbiguityLimitExceeded as exc:
                stats.events.append(
                    f"uniqueness not proved: path limit for {exc.args[0]}"
                )
                _check_deadline(deadline)
                continue
            _check_deadline(deadline)
            if count == 1:
                return SolvedGrid(grid, assignment, list(words))
            stats.ambiguous += 1
    _check_deadline(deadline)
    return None


def _word_entry(
    word: StrandsWord, path: Path, cols: int, spangram_kind: str | None
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "word": word.word,
        "labels": dict(word.labels),
        "is_spangram": spangram_kind is not None,
        "cells": [[cell // cols, cell % cols] for cell in path],
    }
    if word.entity_id is not None:
        entry["id"] = word.entity_id
        entry["canonical_name"] = word.canonical_name
        entry["evidence"] = [dict(ev) for ev in word.evidence]
    if spangram_kind is not None:
        entry["spangram_kind"] = spangram_kind
    return entry


def build_strands_payload(
    theme: StrandsTheme,
    chosen: Sequence[StrandsWord],
    solved: SolvedGrid,
    rows: int,
    cols: int,
    dataset_version: str,
    reference_date: date,
) -> dict[str, Any]:
    assert theme.spangram is not None
    entries = [_word_entry(theme.spangram, solved.paths[0], cols, theme.spangram_kind)]
    rest = sorted(zip(chosen, solved.paths[1:]), key=lambda item: item[0].word)
    entries.extend(_word_entry(word, path, cols, None) for word, path in rest)
    payload: dict[str, Any] = {
        "schema_version": STRANDS_SCHEMA_VERSION,
        "puzzle_id": "",
        "dataset_version": dataset_version,
        "reference_date": reference_date.isoformat(),
        "theme": dict(theme.theme),
    }
    if theme.theme_description is not None:
        payload["theme_description"] = dict(theme.theme_description)
    payload["dimensions"] = {"rows": rows, "cols": cols}
    payload["grid"] = solved.grid
    payload["words"] = entries
    payload["puzzle_id"] = compute_strands_puzzle_id(payload)
    return payload


def _matches_filter(theme: StrandsTheme, query: str) -> bool:
    q = query.strip().lower()
    return (
        q == theme.theme_id.lower()
        or q in theme.theme_id.lower()
        or q in theme.theme["pt-BR"].lower()
        or q in theme.theme["en"].lower()
        or q == theme.target_id.lower()
    )


def _check_dimensions(rows: int, cols: int) -> None:
    for name, value in (("rows", rows), ("cols", cols)):
        if not (STRANDS_MIN_SIDE <= value <= STRANDS_MAX_SIDE):
            raise ValueError(
                f"{name} must be an integer between {STRANDS_MIN_SIDE} and {STRANDS_MAX_SIDE}"
            )


def generate_strands_puzzle(
    connection: sqlite3.Connection,
    seed: str,
    reference_date: date | None = None,
    theme_filter: str | None = None,
    rows: int = STRANDS_DEFAULT_ROWS,
    cols: int = STRANDS_DEFAULT_COLS,
    time_limit_seconds: float = DEFAULT_TIME_LIMIT_SECONDS,
    subsets_per_theme: int = DEFAULT_SUBSETS_PER_THEME,
    attempts: int = DEFAULT_PLACEMENT_ATTEMPTS,
    node_budget: int = DEFAULT_PLACEMENT_NODE_BUDGET,
    stats: PlacementStats | None = None,
    uniqueness_node_budget: int = DEFAULT_UNIQUENESS_NODE_BUDGET,
) -> dict[str, Any]:
    """Deterministically generate a Strands puzzle from audited facts.

    Themes that cannot fill the grid exactly are skipped before the search.
    Feasible themes are tried in a seed-dependent order; each gets
    ``subsets_per_theme`` word draws.  Raises ``StrandsGenerationError`` when
    every theme fails or the time limit runs out.
    """
    _check_dimensions(rows, cols)
    if reference_date is None:
        reference_date = datetime.now(timezone.utc).date()
    deadline = time.monotonic() + time_limit_seconds
    stats = stats if stats is not None else PlacementStats()

    connection.row_factory = sqlite3.Row
    _check_deadline(deadline)
    entities = _load_entities(connection)
    _check_deadline(deadline)
    facts, _rejected = _load_facts(connection, entities)
    _check_deadline(deadline)
    dataset_version = _dataset_version(connection, entities, reference_date)
    _check_deadline(deadline)

    themes = build_strands_themes(entities, facts)
    _check_deadline(deadline)
    if theme_filter is not None:
        themes = [t for t in themes if _matches_filter(t, theme_filter)]
        if not themes:
            raise StrandsGenerationError(
                f"No strands theme matches filter: {theme_filter}"
            )
    feasible = [t for t in themes if assess_theme(t, rows, cols, deadline).feasible]
    if not feasible:
        reasons = sorted(
            {assess_theme(t, rows, cols, deadline).reason or "" for t in themes}
        )
        raise StrandsGenerationError(
            f"No strands theme can fill a {rows}x{cols} grid exactly "
            f"({len(themes)} themes checked; reasons: {', '.join(reasons) or 'no themes'})"
        )

    rng = random.Random(hashlib.sha256(seed.encode("utf-8")).digest())
    order = list(feasible)
    rng.shuffle(order)
    area = rows * cols
    for theme in order:
        assert theme.spangram is not None
        target = area - len(theme.spangram.word)
        for _ in range(subsets_per_theme):
            chosen = choose_word_subset(
                theme.words, target, rng, theme.spangram.word, deadline=deadline
            )
            if chosen is None:
                stats.events.append(f"{theme.theme_id}: no word subset")
                break
            words = [theme.spangram.word, *(w.word for w in chosen)]
            solved = solve_strands_grid(
                words,
                rows,
                cols,
                rng,
                attempts=attempts,
                node_budget=node_budget,
                deadline=deadline,
                stats=stats,
                uniqueness_node_budget=uniqueness_node_budget,
            )
            if solved is None:
                stats.events.append(f"{theme.theme_id}: solver gave up on {words}")
                continue
            payload = build_strands_payload(
                theme, chosen, solved, rows, cols, dataset_version, reference_date
            )
            validate_strands_puzzle(payload)
            _check_deadline(deadline)
            verify_strands_uniqueness(
                payload, node_budget=uniqueness_node_budget, deadline=deadline
            )
            _check_deadline(deadline)
            return payload
    _check_deadline(deadline)
    raise StrandsGenerationError(
        f"Strands solver found no unique {rows}x{cols} grid for "
        f"{len(feasible)} feasible themes within budget"
    )


def describe_themes(
    themes: Iterable[StrandsTheme], sizes: Iterable[tuple[int, int]]
) -> list[dict[str, Any]]:
    """Summarize each theme's words, spangram, discards and feasibility."""
    size_list = list(sizes)
    report = []
    for theme in themes:
        report.append(
            {
                "theme_id": theme.theme_id,
                "theme": theme.theme["en"],
                "spangram": theme.spangram.word if theme.spangram else None,
                "spangram_kind": theme.spangram_kind,
                "spangram_problem": theme.spangram_problem,
                "words": len(theme.words),
                "letters": sum(len(w.word) for w in theme.words),
                "discarded": [
                    {"id": d.entity_id, "name": d.name, "reason": d.reason}
                    for d in theme.discarded
                ],
                "feasibility": {
                    f"{r}x{c}": (lambda a: "ok" if a.feasible else a.reason)(
                        assess_theme(theme, r, c)
                    )
                    for r, c in size_list
                },
            }
        )
    return report
