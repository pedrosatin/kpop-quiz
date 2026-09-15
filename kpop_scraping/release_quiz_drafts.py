"""Build discography quiz drafts from accepted release facts."""

from __future__ import annotations

import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable
from itertools import chain

from .quiz_models import Draft, Entity, Evidence, Fact
from .quiz_utils import digest


def build_release_drafts(
    facts: list[Fact],
) -> tuple[list[Draft], Counter[str]]:
    rejected: Counter[str] = Counter()
    performer_facts = [fact for fact in facts if fact.predicate == "performed_by"]
    date_facts = [fact for fact in facts if fact.predicate == "released_on"]
    ambiguous_release_ids = _ambiguous_release_ids(performer_facts + date_facts)
    performers_by_release = _entity_facts(performer_facts)
    releases_by_group = _subject_facts(performer_facts)
    dates_by_release = _time_facts(date_facts)
    known_groups = {
        fact.value_entity.wikidata_id: fact.value_entity
        for fact in performer_facts
        if fact.value_entity is not None
    }
    leaking_release_ids = _release_ids_mentioning_groups(
        (fact.subject for fact in performer_facts), known_groups.values()
    )
    drafts: list[Draft] = []
    drafts.extend(
        _release_for_group_drafts(
            releases_by_group, performer_facts, ambiguous_release_ids,
            leaking_release_ids, rejected
        )
    )
    drafts.extend(
        _group_for_release_drafts(
            performers_by_release, ambiguous_release_ids, leaking_release_ids, rejected
        )
    )
    drafts.extend(
        _release_year_drafts(
            dates_by_release, performers_by_release, ambiguous_release_ids, rejected
        )
    )
    drafts.extend(
        _earliest_release_drafts(
            dates_by_release, performers_by_release, ambiguous_release_ids, rejected
        )
    )
    return sorted(drafts, key=lambda draft: draft.key), rejected


def _release_for_group_drafts(
    releases_by_group: dict[str, dict[str, list[Fact]]],
    performer_facts: list[Fact],
    ambiguous_release_ids: set[str],
    leaking_release_ids: set[str],
    rejected: Counter[str],
) -> list[Draft]:
    known_releases = {
        fact.subject.wikidata_id: fact.subject for fact in performer_facts
    }
    result = []
    selected_group_by_release = {
        release_id: min(
            group_id for group_id, releases in releases_by_group.items()
            if release_id in releases
        )
        for release_id in known_releases
    }
    for group_id in sorted(releases_by_group):
        group_releases = releases_by_group[group_id]
        excluded = set(group_releases)
        for release_id in sorted(group_releases):
            if release_id in ambiguous_release_ids:
                rejected["release_title_not_unique"] += 1
                continue
            if release_id in leaking_release_ids:
                rejected["release_label_mentions_group"] += 1
                continue
            if selected_group_by_release[release_id] != group_id:
                rejected["release_answer_already_used"] += 1
                continue
            pair = tuple(group_releases[release_id])
            answer = pair[0].subject
            options = _entity_options(
                answer,
                known_releases,
                excluded | ambiguous_release_ids | leaking_release_ids,
                "release",
            )
            if options is None:
                rejected["insufficient_release_distractors"] += 1
                continue
            option_entities = tuple(known_releases[value] for value, _kind in options)
            if not _labels_are_unique(option_entities):
                rejected["release_option_labels_not_unique"] += 1
                continue
            result.append(Draft(
                ("release_for_group", release_id, group_id),
                "release_for_group", "discography", "easy", (group_id,),
                (release_id, "release"), options,
                {"group_id": group_id}, _merge_evidence(pair),
                _fact_ids(pair),
            ))
    return result


def _group_for_release_drafts(
    performers_by_release: dict[str, dict[str, list[Fact]]],
    ambiguous_release_ids: set[str],
    leaking_release_ids: set[str],
    rejected: Counter[str],
) -> list[Draft]:
    known_groups = {
        fact.value_entity.wikidata_id: fact.value_entity
        for groups in performers_by_release.values()
        for facts in groups.values()
        for fact in facts
        if fact.value_entity is not None
    }
    result = []
    for release_id in sorted(performers_by_release):
        if release_id in ambiguous_release_ids:
            rejected["release_title_not_unique"] += 1
            continue
        if release_id in leaking_release_ids:
            rejected["release_label_mentions_group"] += 1
            continue
        groups = performers_by_release[release_id]
        if len(groups) != 1:
            rejected["release_has_multiple_performers"] += 1
            continue
        group_id, pair_list = next(iter(groups.items()))
        pair = tuple(pair_list)
        answer = pair[0].value_entity
        if answer is None:
            continue
        options = _entity_options(answer, known_groups, set(groups))
        if options is None:
            rejected["insufficient_performer_group_distractors"] += 1
            continue
        option_entities = tuple(known_groups[value] for value, _kind in options)
        if not _labels_are_unique(option_entities):
            rejected["group_option_labels_not_unique"] += 1
            continue
        result.append(Draft(
            ("group_for_release", release_id),
            "group_for_release", "discography", "medium", (group_id,),
            (group_id, "group"), options,
            {"release_id": release_id}, _merge_evidence(pair), _fact_ids(pair),
        ))
    return result


def _release_year_drafts(
    dates_by_release: dict[str, dict[tuple[str, int], list[Fact]]],
    performers_by_release: dict[str, dict[str, list[Fact]]],
    ambiguous_release_ids: set[str],
    rejected: Counter[str],
) -> list[Draft]:
    eligible: dict[str, tuple[Fact, ...]] = {}
    for release_id, dated in dates_by_release.items():
        if release_id in ambiguous_release_ids:
            rejected["release_title_not_unique"] += 1
            continue
        years = {value[:4] for value, _precision in dated}
        if len(years) != 1:
            rejected["release_has_multiple_years"] += 1
            continue
        eligible[release_id] = tuple(chain.from_iterable(dated.values()))
    years = {facts[0].value_time[:4] for facts in eligible.values() if facts[0].value_time}
    result = []
    for release_id in sorted(eligible):
        date_group = eligible[release_id]
        year = (date_group[0].value_time or "")[:4]
        alternatives = sorted(
            (candidate for candidate in years if candidate != year),
            key=lambda candidate: (abs(int(candidate) - int(year)), candidate),
        )
        if len(alternatives) < 3:
            rejected["insufficient_release_year_distractors"] += 1
            continue
        result.append(Draft(
            ("release_year", release_id),
            "release_year", "discography", "easy",
            tuple(sorted(performers_by_release.get(release_id, {}))),
            (year, "time"), tuple((value, "time") for value in (year, *alternatives[:3])),
            {"release_id": release_id}, _merge_evidence(date_group),
            _fact_ids(date_group),
        ))
    return result


def _earliest_release_drafts(
    dates_by_release: dict[str, dict[tuple[str, int], list[Fact]]],
    performers_by_release: dict[str, dict[str, list[Fact]]],
    ambiguous_release_ids: set[str],
    rejected: Counter[str],
) -> list[Draft]:
    by_precision: dict[int, list[tuple[str, str, tuple[Fact, ...]]]] = defaultdict(list)
    for release_id, dated in dates_by_release.items():
        if release_id in ambiguous_release_ids:
            rejected["release_title_not_unique"] += 1
            continue
        if len(dated) != 1:
            rejected["release_date_not_unique"] += 1
            continue
        (value, precision), date_facts = next(iter(dated.items()))
        canonical_fact = min(date_facts, key=lambda fact: fact.statement_id)
        if len(date_facts) > 1:
            rejected["duplicate_release_date_facts_ignored"] += len(date_facts) - 1
        by_precision[precision].append((value, release_id, (canonical_fact,)))
    result = []
    for precision in sorted(by_precision):
        entries = sorted(by_precision[precision])
        for value, release_id, answer_facts in entries:
            if sum(candidate_value == value for candidate_value, _qid, _facts in entries) != 1:
                rejected["earliest_release_date_tied"] += 1
                continue
            later_by_date: dict[str, tuple[str, tuple[Fact, ...]]] = {}
            for candidate_value, candidate_id, candidate_facts in entries:
                if candidate_value > value:
                    later_by_date.setdefault(candidate_value, (candidate_id, candidate_facts))
            later = [later_by_date[key] for key in sorted(later_by_date)[:3]]
            if len(later) < 3:
                continue
            selected = ((release_id, answer_facts), *later)
            release_entities = [facts[0].subject for _qid, facts in selected]
            if not _labels_are_unique(release_entities):
                rejected["release_option_labels_not_unique"] += 1
                continue
            compared_facts = tuple(chain.from_iterable(facts for _qid, facts in selected))
            group_ids = tuple(sorted({
                group_id
                for selected_id, _facts in selected
                for group_id in performers_by_release.get(selected_id, {})
            }))
            result.append(Draft(
                ("earliest_release", release_id),
                "earliest_release", "discography", "hard", group_ids,
                (release_id, "release"),
                tuple((selected_id, "release") for selected_id, _facts in selected),
                {"comparison_values": tuple(
                    (selected_id, facts[0].value_time or "", precision)
                    for selected_id, facts in selected
                )},
                _merge_evidence(compared_facts), _fact_ids(compared_facts),
            ))
    return result


def _entity_facts(facts: list[Fact]) -> dict[str, dict[str, list[Fact]]]:
    result: dict[str, dict[str, list[Fact]]] = defaultdict(lambda: defaultdict(list))
    for fact in facts:
        if fact.value_entity is not None:
            result[fact.subject.wikidata_id][fact.value_entity.wikidata_id].append(fact)
    return result


def _subject_facts(facts: list[Fact]) -> dict[str, dict[str, list[Fact]]]:
    result: dict[str, dict[str, list[Fact]]] = defaultdict(lambda: defaultdict(list))
    for fact in facts:
        if fact.value_entity is not None:
            result[fact.value_entity.wikidata_id][fact.subject.wikidata_id].append(fact)
    return result


def _time_facts(facts: list[Fact]) -> dict[str, dict[tuple[str, int], list[Fact]]]:
    result: dict[str, dict[tuple[str, int], list[Fact]]] = defaultdict(lambda: defaultdict(list))
    for fact in facts:
        if fact.value_time and fact.value_precision in {9, 10, 11}:
            result[fact.subject.wikidata_id][(fact.value_time, fact.value_precision)].append(fact)
    return result


def _entity_options(
    answer: Entity,
    pool: dict[str, Entity],
    excluded_ids: set[str],
    kind: str | None = None,
) -> tuple[tuple[str, str], ...] | None:
    candidates = [
        entity for qid, entity in pool.items()
        if qid != answer.wikidata_id and qid not in excluded_ids
    ]
    candidates.sort(key=lambda entity: digest(answer.wikidata_id, entity.wikidata_id))
    if len(candidates) < 3:
        return None
    return tuple(
        (entity.wikidata_id, kind or entity.entity_type)
        for entity in (answer, *candidates[:3])
    )


def _labels_are_unique(entities: list[Entity] | tuple[Entity, ...]) -> bool:
    return all(
        len({_display_key(entity.name(language)) for entity in entities}) == len(entities)
        for language in ("pt-BR", "en")
    )


def _display_key(label: str) -> str:
    normalized = unicodedata.normalize("NFKC", label).casefold()
    return "".join(
        character for character in normalized
        if not character.isspace() and not unicodedata.category(character).startswith("P")
    )


def _match_tokens(label: str) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKD", label).casefold()
    characters = (
        character if character.isalnum() else " "
        for character in normalized
        if not unicodedata.combining(character)
    )
    return tuple("".join(characters).split())


def _contains_identity(label: str, identity: str) -> bool:
    label_tokens = _match_tokens(label)
    identity_tokens = _match_tokens(identity)
    if not identity_tokens:
        return False
    if len(identity_tokens) == 1 and len(identity_tokens[0]) < 3:
        return False
    width = len(identity_tokens)
    return any(
        label_tokens[index:index + width] == identity_tokens
        for index in range(len(label_tokens) - width + 1)
    )


def _release_ids_mentioning_groups(
    releases: Iterable[Entity], groups: Iterable[Entity]
) -> set[str]:
    unique_releases = {release.wikidata_id: release for release in releases}
    identities = {
        identity
        for group in groups
        for identity in group.identity_names()
    }
    return {
        release_id
        for release_id, release in unique_releases.items()
        if any(
            _contains_identity(release.name(language), identity)
            for language in ("pt-BR", "en")
            for identity in identities
        )
    }


def _ambiguous_release_ids(facts: list[Fact]) -> set[str]:
    releases = {
        fact.subject.wikidata_id: fact.subject
        for fact in facts
        if fact.subject.entity_type in {"release", "album"}
    }
    ambiguous: set[str] = set()
    for language in ("pt-BR", "en"):
        ids_by_label: dict[str, set[str]] = defaultdict(set)
        for qid, release in releases.items():
            ids_by_label[_display_key(release.name(language))].add(qid)
        ambiguous.update(
            qid for ids in ids_by_label.values() if len(ids) > 1 for qid in ids
        )
    return ambiguous


def _fact_ids(facts: tuple[Fact, ...]) -> tuple[str, ...]:
    return tuple(sorted({fact.statement_id for fact in facts}))


def _merge_evidence(facts: tuple[Fact, ...]) -> tuple[Evidence, ...]:
    unique = {
        (item.fact_base_id, item.source_url, item.locator, item.source_key, item.revision_id): item
        for fact in facts for item in fact.evidence
    }
    return tuple(unique[key] for key in sorted(unique))
