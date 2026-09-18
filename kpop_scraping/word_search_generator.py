"""Deterministic generation of word search puzzles from audited facts."""

from __future__ import annotations

import hashlib
import random
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Any, Iterable, NamedTuple

from .connections_generator import KNOWN_RECORD_LABELS
from .quiz_models import Entity, Evidence, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_utils import hash_payload
from .word_search_schema import (
    WORD_SEARCH_SCHEMA_VERSION,
    extract_word_coordinates,
    validate_word_search_puzzle,
)

QID_REGEX = re.compile(r"^Q[1-9][0-9]*$")

# Eight linear directions on a 2D grid: (row_step, col_step)
DIRECTIONS: list[tuple[int, int]] = [
    (0, 1),    # Horizontal left to right
    (0, -1),   # Horizontal right to left
    (1, 0),    # Vertical top to bottom
    (-1, 0),   # Vertical bottom to top
    (1, 1),    # Diagonal down-right
    (1, -1),   # Diagonal down-left
    (-1, 1),   # Diagonal up-right
    (-1, -1),  # Diagonal up-left
]

# Letter frequency weights derived from romanized K-pop entity names
LETTER_WEIGHTS: dict[str, int] = {
    "N": 2375,
    "E": 2088,
    "O": 1920,
    "A": 1787,
    "I": 1583,
    "S": 1046,
    "U": 1038,
    "T": 913,
    "H": 909,
    "R": 906,
    "G": 862,
    "Y": 814,
    "M": 756,
    "L": 646,
    "K": 595,
    "C": 555,
    "J": 488,
    "D": 477,
    "P": 375,
    "B": 356,
    "W": 298,
    "F": 146,
    "V": 132,
    "X": 81,
    "Z": 78,
    "Q": 26,
}

_WEIGHTED_LETTERS = list(LETTER_WEIGHTS.keys())
_WEIGHTS_LIST = list(LETTER_WEIGHTS.values())


def normalize_word(name: str) -> str:
    """Normalize a display name to uppercase ASCII alphabetic characters.

    Decomposes accents via NFKD, strips non-alphabetical characters and spaces,
    and returns uppercase letters in the [A-Z] range.
    """
    decomposed = unicodedata.normalize("NFKD", name).upper()
    return "".join(c for c in decomposed if "A" <= c <= "Z")


def _serialize_evidence(evidence_items: Iterable[Evidence]) -> list[dict[str, Any]]:
    """Deduplicate and sort evidence records canonically."""
    unique: dict[tuple[str, str, int, str, str], dict[str, Any]] = {}
    for ev in evidence_items:
        key = (
            ev.fact_base_id,
            ev.locator,
            ev.revision_id,
            ev.source_key,
            ev.source_url,
        )
        if key not in unique:
            unique[key] = {
                "fact_base_id": ev.fact_base_id,
                "locator": ev.locator,
                "revision_id": ev.revision_id,
                "source_key": ev.source_key,
                "source_url": ev.source_url,
            }
    return [unique[k] for k in sorted(unique.keys())]


class WordCandidate(NamedTuple):
    id: str
    word: str
    canonical_name: str
    labels: dict[str, str]
    clue: dict[str, str] | None
    evidence: list[dict[str, Any]]


class ThemeDefinition(NamedTuple):
    theme_id: str
    category: str
    target_id: str
    theme: dict[str, str]
    theme_description: dict[str, str] | None
    candidates: list[WordCandidate]


class PlacedWord(NamedTuple):
    candidate: WordCandidate
    start_row: int
    start_col: int
    end_row: int
    end_col: int
    direction: tuple[int, int]


def _build_candidate(
    entity: Entity,
    facts: list[Fact],
    min_dim: int,
    clue: dict[str, str] | None = None,
) -> WordCandidate | None:
    """Build a word candidate if entity has a valid name and audited evidence."""
    if not bool(QID_REGEX.match(entity.wikidata_id)):
        return None

    # Determine word representation: try canonical_name first, then aliases/labels
    norm = normalize_word(entity.canonical_name)
    if not (3 <= len(norm) <= min(16, min_dim)):
        alt_names = [entity.names.get("pt"), entity.names.get("en")] + list(entity.aliases)
        found = False
        for alt in alt_names:
            if alt:
                alt_norm = normalize_word(alt)
                if 3 <= len(alt_norm) <= min(16, min_dim):
                    norm = alt_norm
                    found = True
                    break
        if not found:
            return None

    all_evidence: list[Evidence] = []
    for f in facts:
        all_evidence.extend(f.evidence)

    serialized = _serialize_evidence(all_evidence)
    if not serialized:
        return None

    pt_name = entity.names.get("pt") or entity.names.get("pt-BR") or entity.canonical_name
    en_name = entity.names.get("en") or entity.canonical_name
    if normalize_word(pt_name) != norm:
        pt_name = entity.canonical_name
    if normalize_word(en_name) != norm:
        en_name = entity.canonical_name
    labels = {"pt-BR": pt_name, "en": en_name}

    return WordCandidate(
        id=entity.wikidata_id,
        word=norm,
        canonical_name=entity.canonical_name,
        labels=labels,
        clue=clue,
        evidence=serialized,
    )


def extract_viable_themes(
    entities: dict[int, Entity],
    facts: list[Fact],
    rows: int,
    cols: int,
    min_candidates: int = 5,
) -> list[ThemeDefinition]:
    """Extract all thematic groups satisfying candidate count thresholds."""
    min_dim = min(rows, cols)
    viable_themes: list[ThemeDefinition] = []

    # 1. Record label themes
    label_groups: dict[str, list[tuple[Entity, list[Fact]]]] = defaultdict(list)
    label_entities: dict[str, Entity] = {}

    for fact in facts:
        if fact.predicate == "record_label" and fact.value_entity:
            label_ent = fact.value_entity
            label_groups[label_ent.wikidata_id].append((fact.subject, [fact]))
            label_entities[label_ent.wikidata_id] = label_ent

    for label_qid, group_entries in label_groups.items():
        label_ent = label_entities[label_qid]
        pt_label = label_ent.names.get("pt") or label_ent.names.get("pt-BR") or label_ent.canonical_name
        en_label = label_ent.names.get("en") or label_ent.canonical_name

        seen_words: set[str] = set()
        seen_qids: set[str] = set()
        candidates: list[WordCandidate] = []

        # Sort group entries deterministically
        sorted_entries = sorted(group_entries, key=lambda item: item[0].wikidata_id)
        for group_ent, group_facts in sorted_entries:
            if group_ent.wikidata_id in seen_qids:
                continue
            cand = _build_candidate(
                group_ent,
                group_facts,
                min_dim,
                clue={
                    "pt-BR": f"Grupo musical da gravadora {pt_label}",
                    "en": f"Music group from record label {en_label}",
                },
            )
            if cand is not None and cand.word not in seen_words:
                seen_words.add(cand.word)
                seen_qids.add(cand.id)
                candidates.append(cand)

        if len(candidates) >= min_candidates:
            if label_qid in KNOWN_RECORD_LABELS:
                theme_id = KNOWN_RECORD_LABELS[label_qid][0]
            else:
                theme_id = f"label_{label_qid.lower()}"

            viable_themes.append(
                ThemeDefinition(
                    theme_id=theme_id,
                    category="record_label",
                    target_id=label_qid,
                    theme={
                        "pt-BR": f"Grupos da gravadora {pt_label}",
                        "en": f"Groups from {en_label}",
                    },
                    theme_description={
                        "pt-BR": f"Grupos musicais associados à gravadora {pt_label}.",
                        "en": f"Music groups associated with record label {en_label}.",
                    },
                    candidates=candidates,
                )
            )

    # 2. Formation decade themes
    decade_groups: dict[int, list[tuple[Entity, list[Fact]]]] = defaultdict(list)
    for fact in facts:
        if fact.predicate == "formed_on" and fact.value_time:
            match = re.search(r"(\d{4})", fact.value_time)
            if match:
                year = int(match.group(1))
                decade = (year // 10) * 10
                if decade in {1990, 2000, 2010, 2020}:
                    decade_groups[decade].append((fact.subject, [fact]))

    for decade, group_entries in decade_groups.items():
        seen_words = set()
        seen_qids = set()
        candidates = []

        sorted_entries = sorted(group_entries, key=lambda item: item[0].wikidata_id)
        for group_ent, group_facts in sorted_entries:
            if group_ent.wikidata_id in seen_qids:
                continue
            cand = _build_candidate(
                group_ent,
                group_facts,
                min_dim,
                clue={
                    "pt-BR": f"Grupo formado na década de {decade}",
                    "en": f"Group formed in the {decade}s",
                },
            )
            if cand is not None and cand.word not in seen_words:
                seen_words.add(cand.word)
                seen_qids.add(cand.id)
                candidates.append(cand)

        if len(candidates) >= min_candidates:
            viable_themes.append(
                ThemeDefinition(
                    theme_id=f"formed_{decade}s",
                    category="formed_on",
                    target_id=str(decade),
                    theme={
                        "pt-BR": f"Grupos dos anos {decade}",
                        "en": f"{decade}s Groups",
                    },
                    theme_description={
                        "pt-BR": f"Grupos de K-pop formados na década de {decade}.",
                        "en": f"K-pop groups formed in the {decade}s.",
                    },
                    candidates=candidates,
                )
            )

    # 3. Group members themes (has_member and member_of)
    members_by_group: dict[str, list[tuple[Entity, list[Fact]]]] = defaultdict(list)
    group_entities: dict[str, Entity] = {}

    for fact in facts:
        if fact.predicate == "has_member" and fact.value_entity:
            group_ent = fact.subject
            member_ent = fact.value_entity
            members_by_group[group_ent.wikidata_id].append((member_ent, [fact]))
            group_entities[group_ent.wikidata_id] = group_ent
        elif fact.predicate == "member_of" and fact.value_entity:
            group_ent = fact.value_entity
            member_ent = fact.subject
            members_by_group[group_ent.wikidata_id].append((member_ent, [fact]))
            group_entities[group_ent.wikidata_id] = group_ent

    for group_qid, member_entries in members_by_group.items():
        group_ent = group_entities[group_qid]
        group_pt = group_ent.names.get("pt") or group_ent.names.get("pt-BR") or group_ent.canonical_name
        group_en = group_ent.names.get("en") or group_ent.canonical_name

        seen_words = set()
        seen_qids = set()
        candidates = []

        sorted_entries = sorted(member_entries, key=lambda item: item[0].wikidata_id)
        for member_ent, member_facts in sorted_entries:
            if member_ent.wikidata_id in seen_qids:
                continue
            cand = _build_candidate(
                member_ent,
                member_facts,
                min_dim,
                clue={
                    "pt-BR": f"Integrante do grupo {group_pt}",
                    "en": f"Member of {group_en}",
                },
            )
            if cand is not None and cand.word not in seen_words:
                seen_words.add(cand.word)
                seen_qids.add(cand.id)
                candidates.append(cand)

        if len(candidates) >= min_candidates:
            viable_themes.append(
                ThemeDefinition(
                    theme_id=f"members_{group_qid.lower()}",
                    category="has_member",
                    target_id=group_qid,
                    theme={
                        "pt-BR": f"Integrantes do grupo {group_pt}",
                        "en": f"Members of {group_en}",
                    },
                    theme_description={
                        "pt-BR": f"Integrantes documentados do grupo {group_pt}.",
                        "en": f"Documented members of the group {group_en}.",
                    },
                    candidates=candidates,
                )
            )

    return viable_themes


def find_word_occurrences(grid: list[list[str]], word: str) -> list[tuple[int, int, int, int]]:
    """Find all start and end coordinates where the target word occurs in the grid."""
    rows = len(grid)
    cols = len(grid[0]) if rows > 0 else 0
    length = len(word)
    occurrences: list[tuple[int, int, int, int]] = []

    for r in range(rows):
        for c in range(cols):
            for dr, dc in DIRECTIONS:
                end_r = r + (length - 1) * dr
                end_c = c + (length - 1) * dc
                if 0 <= end_r < rows and 0 <= end_c < cols:
                    if all(grid[r + i * dr][c + i * dc] == word[i] for i in range(length)):
                        occurrences.append((r, c, end_r, end_c))

    return occurrences


def place_words_on_grid(
    candidates: list[WordCandidate],
    rows: int,
    cols: int,
    rng: random.Random,
    max_backtracks: int = 2000,
) -> tuple[list[list[str | None]], list[PlacedWord]] | None:
    """Place candidate words on grid with intersection support and direction variety."""
    grid: list[list[str | None]] = [[None for _ in range(cols)] for _ in range(rows)]
    placed: list[PlacedWord] = []
    dir_usage: Counter[tuple[int, int]] = Counter()

    sorted_candidates = sorted(candidates, key=lambda c: (-len(c.word), c.word))

    def can_place(word: str, r: int, c: int, dr: int, dc: int) -> bool:
        length = len(word)
        er = r + (length - 1) * dr
        ec = c + (length - 1) * dc
        if not (0 <= er < rows and 0 <= ec < cols):
            return False
        for i in range(length):
            cell = grid[r + i * dr][c + i * dc]
            if cell is not None and cell != word[i]:
                return False
        return True

    def apply_word(word: str, r: int, c: int, dr: int, dc: int) -> None:
        for i in range(len(word)):
            grid[r + i * dr][c + i * dc] = word[i]
        dir_usage[(dr, dc)] += 1

    def revert_word(
        r: int, c: int, dr: int, dc: int, original: list[str | None]
    ) -> None:
        for i, original_char in enumerate(original):
            grid[r + i * dr][c + i * dc] = original_char
        dir_usage[(dr, dc)] -= 1

    step_counter = [0]

    def backtrack(idx: int) -> bool:
        step_counter[0] += 1
        if step_counter[0] > max_backtracks:
            return False
        if idx == len(sorted_candidates):
            return True

        cand = sorted_candidates[idx]
        word = cand.word
        length = len(word)

        # Sort directions by usage count ascending to balance direction distribution
        shuffled_dirs = list(DIRECTIONS)
        rng.shuffle(shuffled_dirs)
        sorted_dirs = sorted(shuffled_dirs, key=lambda d: dir_usage[d])

        candidate_positions: list[tuple[int, int, int, int]] = []
        for dr, dc in sorted_dirs:
            dir_positions: list[tuple[int, int, int, int]] = []
            for r in range(rows):
                for c in range(cols):
                    if can_place(word, r, c, dr, dc):
                        dir_positions.append((r, c, dr, dc))
            rng.shuffle(dir_positions)
            candidate_positions.extend(dir_positions)

        for r, c, dr, dc in candidate_positions:
            er = r + (length - 1) * dr
            ec = c + (length - 1) * dc
            original = [grid[r + i * dr][c + i * dc] for i in range(length)]
            apply_word(word, r, c, dr, dc)
            placed_item = PlacedWord(
                candidate=cand,
                start_row=r,
                start_col=c,
                end_row=er,
                end_col=ec,
                direction=(dr, dc),
            )
            placed.append(placed_item)

            if backtrack(idx + 1):
                return True

            placed.pop()
            revert_word(r, c, dr, dc, original)

        return False

    success = backtrack(0)
    if success:
        return grid, placed
    return None


def fill_empty_cells_and_verify(
    grid: list[list[str | None]],
    placed: list[PlacedWord],
    rng: random.Random,
    max_fill_attempts: int = 50,
) -> list[list[str]] | None:
    """Fill empty grid cells with weighted characters and verify word uniqueness."""
    rows = len(grid)
    cols = len(grid[0])
    empty_cells = [(r, c) for r in range(rows) for c in range(cols) if grid[r][c] is None]

    for _ in range(max_fill_attempts):
        completed: list[list[str]] = [
            [cell if cell is not None else "" for cell in row] for row in grid
        ]
        drawn_letters = rng.choices(_WEIGHTED_LETTERS, weights=_WEIGHTS_LIST, k=len(empty_cells))
        for (r, c), char in zip(empty_cells, drawn_letters):
            completed[r][c] = char

        # Verify uniqueness: each target word must appear exactly once at declared coordinates
        spurious = False
        for p in placed:
            matches = find_word_occurrences(completed, p.candidate.word)
            expected = (p.start_row, p.start_col, p.end_row, p.end_col)
            is_palindrome = p.candidate.word == p.candidate.word[::-1]
            if is_palindrome:
                reverse_expected = (p.end_row, p.end_col, p.start_row, p.start_col)
                if set(matches) != {expected, reverse_expected} or len(matches) != 2:
                    spurious = True
                    break
            else:
                if len(matches) != 1 or matches[0] != expected:
                    spurious = True
                    break

        if not spurious:
            return completed

    return None


def generate_word_search_puzzle(
    connection: sqlite3.Connection,
    seed: str,
    reference_date: date | None = None,
    theme_filter: str | None = None,
    rows: int = 12,
    cols: int = 12,
) -> dict[str, Any]:
    """Deterministically generate a word search puzzle from audited database facts.

    Raises ValueError if parameters are invalid or database contains insufficient facts.
    """
    if not (8 <= rows <= 16):
        raise ValueError("rows must be an integer between 8 and 16")
    if not (8 <= cols <= 16):
        raise ValueError("cols must be an integer between 8 and 16")

    if reference_date is None:
        reference_date = datetime.now(timezone.utc).date()

    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    facts, _rejected = _load_facts(connection, entities)
    dataset_version = _dataset_version(connection, entities, reference_date)

    viable_themes = extract_viable_themes(entities, facts, rows, cols)
    if not viable_themes:
        raise ValueError("No viable themes found in database for word search puzzle")

    # Filter themes if requested
    if theme_filter is not None:
        q = theme_filter.strip().lower()
        matched = [
            t
            for t in viable_themes
            if q == t.theme_id.lower()
            or q in t.theme_id.lower()
            or q in t.theme["pt-BR"].lower()
            or q in t.theme["en"].lower()
            or q in t.category.lower()
            or q == t.target_id.lower()
        ]
        if not matched:
            raise ValueError(f"No viable theme matches filter: {theme_filter}")
        viable_themes = matched

    # Sort themes deterministically
    viable_themes.sort(key=lambda t: (t.category, t.theme_id))

    # Initialize deterministic RNG stream
    seed_bytes = hashlib.sha256(seed.encode("utf-8")).digest()
    rng = random.Random(seed_bytes)

    chosen_theme = rng.choice(viable_themes)

    # Candidate subset selection and placement loop
    candidates_pool = sorted(chosen_theme.candidates, key=lambda c: (c.word, c.id))
    min_select = min(len(candidates_pool), 6)
    max_select = min(len(candidates_pool), 10)
    target_count = rng.randint(min_select, max_select)

    final_grid: list[list[str]] | None = None
    final_placed: list[PlacedWord] | None = None

    attempts = 0
    while attempts < 30 and (final_grid is None or final_placed is None):
        attempts += 1
        subset = rng.sample(candidates_pool, target_count)
        placement_result = place_words_on_grid(subset, rows, cols, rng)
        if placement_result is not None:
            raw_grid, placed_words = placement_result
            completed_grid = fill_empty_cells_and_verify(raw_grid, placed_words, rng)
            if completed_grid is not None:
                final_grid = completed_grid
                final_placed = placed_words
                break

        # Decrement target count if upper bound attempts fail
        if attempts % 10 == 0 and target_count > min_select:
            target_count -= 1

    if final_grid is None or final_placed is None:
        raise ValueError(
            f"Failed to place word search grid for theme {chosen_theme.theme_id} within budget"
        )

    # Build words payload sorted alphabetically by word
    words_payload: list[dict[str, Any]] = []
    for p in sorted(final_placed, key=lambda item: item.candidate.word):
        word_entry: dict[str, Any] = {
            "id": p.candidate.id,
            "word": p.candidate.word,
            "canonical_name": p.candidate.canonical_name,
            "labels": p.candidate.labels,
            "start_row": p.start_row,
            "start_col": p.start_col,
            "end_row": p.end_row,
            "end_col": p.end_col,
            "evidence": p.candidate.evidence,
        }
        if p.candidate.clue is not None:
            word_entry["clue"] = p.candidate.clue
        words_payload.append(word_entry)

    reference_date_str = reference_date.isoformat()
    dimensions = {"rows": rows, "cols": cols}

    hashable_payload: dict[str, Any] = {
        "dataset_version": dataset_version,
        "dimensions": dimensions,
        "grid": final_grid,
        "reference_date": reference_date_str,
        "schema_version": WORD_SEARCH_SCHEMA_VERSION,
        "theme": chosen_theme.theme,
        "words": words_payload,
    }
    if chosen_theme.theme_description is not None:
        hashable_payload["theme_description"] = chosen_theme.theme_description

    puzzle_id = hash_payload(hashable_payload)

    puzzle: dict[str, Any] = {
        "schema_version": WORD_SEARCH_SCHEMA_VERSION,
        "puzzle_id": puzzle_id,
        "dataset_version": dataset_version,
        "reference_date": reference_date_str,
        "theme": chosen_theme.theme,
        "dimensions": dimensions,
        "grid": final_grid,
        "words": words_payload,
    }
    if chosen_theme.theme_description is not None:
        puzzle["theme_description"] = chosen_theme.theme_description

    validate_word_search_puzzle(puzzle)
    return puzzle
