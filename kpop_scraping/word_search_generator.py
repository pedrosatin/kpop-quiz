"""Deterministic generation of word search puzzles from audited facts."""

from __future__ import annotations

import hashlib
import random
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterable, NamedTuple

from .connections_generator import KNOWN_RECORD_LABELS
from .quiz_models import Entity, Evidence, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_utils import hash_payload
from .word_search_schema import (
    WORD_SEARCH_SCHEMA_VERSION,
    extract_word_coordinates,
    validate_word_search_clues,
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
    # Evidence for the fact quoted in ``clue``. It is published together with
    # ``evidence`` only while the clue is kept.
    clue_evidence: tuple[dict[str, Any], ...] | list[dict[str, Any]] = ()

    def published_evidence(self) -> list[dict[str, Any]]:
        if self.clue is None or not self.clue_evidence:
            return self.evidence
        return _merge_serialized_evidence(self.evidence, self.clue_evidence)


class ClueOption(NamedTuple):
    """One audited fact that can tell a word apart from the other theme words."""

    kind: str
    text: dict[str, str]
    evidence: tuple[Evidence, ...]


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


# Lower value wins when two clue options are equally rare within a theme.
CLUE_KIND_PRIORITY: dict[str, int] = {
    "birth_year": 0,
    "formation_year": 1,
    "record_label": 2,
    "other_group": 3,
}

_YEAR_PRECISION = 9


def _merge_serialized_evidence(*groups: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str, int, str, str], dict[str, Any]] = {}
    for group in groups:
        for item in group:
            key = (
                item["fact_base_id"],
                item["locator"],
                item["revision_id"],
                item["source_key"],
                item["source_url"],
            )
            unique.setdefault(key, item)
    return [unique[key] for key in sorted(unique)]


def _display_name(entity: Entity, min_dim: int) -> tuple[str, str] | None:
    """Return the name shown to the player and its normalized grid word.

    People and groups are identities, not translations (see ``Entity.name``),
    so the same source name labels the word in every locale.  The canonical
    name wins; Wikidata labels and aliases are used only when the canonical
    name does not fit the grid.
    """
    max_len = min(16, min_dim)
    names = [
        entity.canonical_name,
        entity.names.get("pt"),
        entity.names.get("en"),
        *entity.aliases,
    ]
    for name in names:
        if name:
            word = normalize_word(name)
            if 3 <= len(word) <= max_len:
                return name, word
    return None


def _build_candidate(
    entity: Entity,
    facts: list[Fact],
    min_dim: int,
) -> WordCandidate | None:
    """Build a word candidate if entity has a valid name and audited evidence."""
    if not bool(QID_REGEX.match(entity.wikidata_id)):
        return None

    display = _display_name(entity, min_dim)
    if display is None:
        return None
    name, norm = display

    all_evidence: list[Evidence] = []
    for f in facts:
        all_evidence.extend(f.evidence)

    serialized = _serialize_evidence(all_evidence)
    if not serialized:
        return None

    return WordCandidate(
        id=entity.wikidata_id,
        word=norm,
        canonical_name=entity.canonical_name,
        labels={"pt-BR": name, "en": name},
        clue=None,
        evidence=serialized,
    )


def _fact_year(fact: Fact) -> int | None:
    """Return the year of a time fact when its precision covers at least a year."""
    if not fact.value_time:
        return None
    if fact.value_precision is not None and fact.value_precision < _YEAR_PRECISION:
        return None
    match = re.match(r"^[+-]?(\d{4})-", fact.value_time)
    return int(match.group(1)) if match else None


def _year_option(kind: str, facts: list[Fact], text: dict[str, str]) -> ClueOption | None:
    years = {_fact_year(fact) for fact in facts}
    if len(years) != 1 or None in years:
        # Missing or disagreeing years are not stated as a clue.
        return None
    (year,) = years
    return ClueOption(
        kind,
        {lang: value.format(year=year) for lang, value in text.items()},
        tuple(ev for fact in facts for ev in fact.evidence),
    )


class _FactIndex:
    """Accepted facts grouped by subject for clue lookups."""

    def __init__(self, facts: list[Fact]) -> None:
        self.born: dict[str, list[Fact]] = defaultdict(list)
        self.formed: dict[str, list[Fact]] = defaultdict(list)
        self.labels: dict[str, dict[str, tuple[Entity, list[Fact]]]] = defaultdict(dict)
        self.groups: dict[str, dict[str, tuple[Entity, list[Fact]]]] = defaultdict(dict)
        for fact in facts:
            subject_id = fact.subject.wikidata_id
            if fact.predicate == "born_on":
                self.born[subject_id].append(fact)
            elif fact.predicate == "formed_on":
                self.formed[subject_id].append(fact)
            elif fact.predicate == "record_label" and fact.value_entity:
                label = fact.value_entity
                entry = self.labels[subject_id].setdefault(label.wikidata_id, (label, []))
                entry[1].append(fact)
            elif fact.predicate in {"has_member", "member_of"} and fact.value_entity:
                if fact.predicate == "has_member":
                    group, person = fact.subject, fact.value_entity
                else:
                    group, person = fact.value_entity, fact.subject
                entry = self.groups[person.wikidata_id].setdefault(
                    group.wikidata_id, (group, [])
                )
                entry[1].append(fact)

    def birth_year(self, entity: Entity) -> ClueOption | None:
        return _year_option(
            "birth_year",
            self.born.get(entity.wikidata_id, []),
            {"pt-BR": "Nasceu em {year}", "en": "Born in {year}"},
        )

    def formation_year(self, entity: Entity) -> ClueOption | None:
        return _year_option(
            "formation_year",
            self.formed.get(entity.wikidata_id, []),
            {"pt-BR": "Grupo formado em {year}", "en": "Group formed in {year}"},
        )

    def record_labels(self, entity: Entity, exclude: str | None = None) -> list[ClueOption]:
        options = []
        for label_qid, (label, label_facts) in sorted(self.labels.get(entity.wikidata_id, {}).items()):
            if label_qid == exclude:
                continue
            options.append(
                ClueOption(
                    "record_label",
                    {
                        "pt-BR": f"Grupo da gravadora {label.name('pt-BR')}",
                        "en": f"Group from record label {label.name('en')}",
                    },
                    tuple(ev for fact in label_facts for ev in fact.evidence),
                )
            )
        return options

    def other_groups(self, entity: Entity, exclude: str) -> list[ClueOption]:
        options = []
        for group_qid, (group, group_facts) in sorted(self.groups.get(entity.wikidata_id, {}).items()):
            if group_qid == exclude:
                continue
            options.append(
                ClueOption(
                    "other_group",
                    {
                        "pt-BR": f"Também integrante de {group.name('pt-BR')}",
                        "en": f"Also a member of {group.name('en')}",
                    },
                    tuple(ev for fact in group_facts for ev in fact.evidence),
                )
            )
        return options


def _text_key(text: dict[str, str]) -> tuple[str, str]:
    return (text["pt-BR"].strip().casefold(), text["en"].strip().casefold())


def _assign_clues(
    pairs: list[tuple[WordCandidate, list[ClueOption]]],
    theme: dict[str, str],
) -> list[WordCandidate]:
    """Give each candidate the audited clue that is rarest within its theme.

    Rule: among the candidate's clue options, pick the text shared by the
    fewest candidates of the theme, then by ``CLUE_KIND_PRIORITY``, then by the
    English text.  Options whose text equals the theme title are discarded.  A
    candidate without options gets no clue; the theme alone is not a clue.
    """
    theme_key = _text_key(theme)
    usable: list[list[ClueOption]] = [
        [
            option
            for option in options
            if option.text["pt-BR"].strip().casefold() != theme_key[0]
            and option.text["en"].strip().casefold() != theme_key[1]
        ]
        for _cand, options in pairs
    ]
    frequency: Counter[tuple[str, str]] = Counter()
    for options in usable:
        frequency.update({_text_key(option.text) for option in options})

    result: list[WordCandidate] = []
    for (cand, _options), options in zip(pairs, usable):
        if not options:
            result.append(cand._replace(clue=None, clue_evidence=()))
            continue
        best = min(
            options,
            key=lambda option: (
                frequency[_text_key(option.text)],
                CLUE_KIND_PRIORITY[option.kind],
                option.text["en"],
            ),
        )
        result.append(
            cand._replace(
                clue=dict(best.text),
                clue_evidence=_serialize_evidence(best.evidence),
            )
        )
    return result


def _drop_uninformative_clues(candidates: list[WordCandidate]) -> list[WordCandidate]:
    """Remove clues when every clued word in a puzzle carries the same text."""
    clued = [cand for cand in candidates if cand.clue is not None]
    if len(clued) >= 2 and len({_text_key(cand.clue) for cand in clued}) == 1:  # type: ignore[arg-type]
        return [cand._replace(clue=None, clue_evidence=()) for cand in candidates]
    return candidates


def _collect_candidates(
    entries: list[tuple[Entity, list[Fact]]],
    min_dim: int,
    clue_options: Callable[[Entity], list[ClueOption | None]],
) -> list[tuple[WordCandidate, list[ClueOption]]]:
    seen_words: set[str] = set()
    seen_qids: set[str] = set()
    pairs: list[tuple[WordCandidate, list[ClueOption]]] = []
    for entity, entity_facts in sorted(entries, key=lambda item: item[0].wikidata_id):
        if entity.wikidata_id in seen_qids:
            continue
        cand = _build_candidate(entity, entity_facts, min_dim)
        if cand is not None and cand.word not in seen_words:
            seen_words.add(cand.word)
            seen_qids.add(cand.id)
            pairs.append((cand, [option for option in clue_options(entity) if option]))
    return pairs


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
    index = _FactIndex(facts)

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
        pt_label = label_ent.name("pt-BR")
        en_label = label_ent.name("en")
        theme = {
            "pt-BR": f"Grupos da gravadora {pt_label}",
            "en": f"Groups from {en_label}",
        }
        pairs = _collect_candidates(
            group_entries,
            min_dim,
            lambda entity, label_qid=label_qid: [
                index.formation_year(entity),
                *index.record_labels(entity, exclude=label_qid),
            ],
        )

        if len(pairs) >= min_candidates:
            if label_qid in KNOWN_RECORD_LABELS:
                theme_id = KNOWN_RECORD_LABELS[label_qid][0]
            else:
                theme_id = f"label_{label_qid.lower()}"

            viable_themes.append(
                ThemeDefinition(
                    theme_id=theme_id,
                    category="record_label",
                    target_id=label_qid,
                    theme=theme,
                    theme_description={
                        "pt-BR": f"Grupos musicais associados à gravadora {pt_label}.",
                        "en": f"Music groups associated with record label {en_label}.",
                    },
                    candidates=_assign_clues(pairs, theme),
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
        theme = {
            "pt-BR": f"Grupos dos anos {decade}",
            "en": f"{decade}s Groups",
        }
        pairs = _collect_candidates(
            group_entries,
            min_dim,
            lambda entity: [index.formation_year(entity), *index.record_labels(entity)],
        )

        if len(pairs) >= min_candidates:
            viable_themes.append(
                ThemeDefinition(
                    theme_id=f"formed_{decade}s",
                    category="formed_on",
                    target_id=str(decade),
                    theme=theme,
                    theme_description={
                        "pt-BR": f"Grupos de K-pop formados na década de {decade}.",
                        "en": f"K-pop groups formed in the {decade}s.",
                    },
                    candidates=_assign_clues(pairs, theme),
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
        group_pt = group_ent.name("pt-BR")
        group_en = group_ent.name("en")
        theme = {
            "pt-BR": f"Integrantes do grupo {group_pt}",
            "en": f"Members of {group_en}",
        }
        pairs = _collect_candidates(
            member_entries,
            min_dim,
            lambda entity, group_qid=group_qid: [
                index.birth_year(entity),
                *index.other_groups(entity, exclude=group_qid),
            ],
        )

        if len(pairs) >= min_candidates:
            viable_themes.append(
                ThemeDefinition(
                    theme_id=f"members_{group_qid.lower()}",
                    category="has_member",
                    target_id=group_qid,
                    theme=theme,
                    theme_description={
                        "pt-BR": f"Integrantes documentados do grupo {group_pt}.",
                        "en": f"Documented members of the group {group_en}.",
                    },
                    candidates=_assign_clues(pairs, theme),
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
    ordered_placed = sorted(final_placed, key=lambda item: item.candidate.word)
    final_candidates = _drop_uninformative_clues([p.candidate for p in ordered_placed])
    words_payload: list[dict[str, Any]] = []
    for p, candidate in zip(ordered_placed, final_candidates):
        word_entry: dict[str, Any] = {
            "id": candidate.id,
            "word": candidate.word,
            "canonical_name": candidate.canonical_name,
            "labels": candidate.labels,
            "start_row": p.start_row,
            "start_col": p.start_col,
            "end_row": p.end_row,
            "end_col": p.end_col,
            "evidence": candidate.published_evidence(),
        }
        if candidate.clue is not None:
            word_entry["clue"] = candidate.clue
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
    validate_word_search_clues(puzzle)
    return puzzle
