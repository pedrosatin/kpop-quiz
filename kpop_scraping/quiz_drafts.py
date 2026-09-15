"""Build language-neutral quiz drafts from accepted facts."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Iterable

from .quiz_models import Draft, Entity, Evidence, Fact
from .quiz_utils import digest
from .release_quiz_drafts import build_release_drafts


def _build_drafts(
    facts: list[Fact],
    entities: dict[int, Entity],
    reference_date: date,
) -> tuple[list[Draft], Counter[str]]:
    rejected: Counter[str] = Counter()
    drafts: list[Draft] = []
    formed = [fact for fact in facts if fact.predicate == "formed_on"]
    born = [fact for fact in facts if fact.predicate == "born_on"]
    memberships = _membership_pairs(facts)
    has_members = [fact for fact in facts if fact.predicate == "has_member"]
    record_labels = [fact for fact in facts if fact.predicate == "record_label"]
    supported_group_ids = {
        fact.subject.wikidata_id for fact in formed
    } | {group.wikidata_id for group, _person, _pair in memberships}
    supported_person_ids = {
        fact.subject.wikidata_id for fact in born
    } | {person.wikidata_id for _group, person, _pair in memberships}
    groups = sorted(
        (
            entity for entity in entities.values()
            if entity.entity_type == "group" and entity.wikidata_id in supported_group_ids
        ),
        key=lambda entity: entity.wikidata_id,
    )
    people = sorted(
        (
            entity for entity in entities.values()
            if entity.entity_type == "person" and entity.wikidata_id in supported_person_ids
        ),
        key=lambda entity: entity.wikidata_id,
    )

    member_ids_by_group: dict[str, set[str]] = defaultdict(set)
    for fact in has_members:
        if fact.value_entity is not None:
            member_ids_by_group[fact.subject.wikidata_id].add(
                fact.value_entity.wikidata_id
            )
    member_people = sorted(
        {
            fact.value_entity.wikidata_id: fact.value_entity
            for fact in has_members
            if fact.value_entity is not None
        }.values(),
        key=lambda entity: entity.wikidata_id,
    )
    group_ids_by_person: dict[str, set[str]] = defaultdict(set)
    for group, person, _pair in memberships:
        group_ids_by_person[person.wikidata_id].add(group.wikidata_id)

    for fact in formed:
        alternatives = _year_alternatives(fact, formed)
        if alternatives is None:
            rejected["insufficient_formation_year_distractors"] += 1
            continue
        drafts.append(
            Draft(
                ("formation_year", fact.statement_id),
                "formation_year", "history", "easy", (fact.subject.wikidata_id,),
                ((fact.value_time or "")[:4], "time"), alternatives,
                {"group_id": fact.subject.wikidata_id}, fact.evidence,
                (fact.statement_id,),
            )
        )

    for fact in born:
        alternatives = _time_alternatives(fact, born)
        if alternatives is None:
            rejected["insufficient_birth_date_distractors"] += 1
        else:
            drafts.append(
                Draft(
                    ("birth_date_or_place", fact.statement_id),
                    "birth_date_or_place", "people", "easy",
                    _groups_for_person(fact.subject.wikidata_id, memberships),
                    (fact.value_time or "", "time"), alternatives,
                    {"person_id": fact.subject.wikidata_id}, fact.evidence,
                    (fact.statement_id,),
                )
            )
        if fact.value_precision != 11 or "insufficient_precision_for_age" in fact.flags:
            rejected["insufficient_precision_for_age"] += 1
            continue
        if date.fromisoformat(fact.value_time or "") > reference_date:
            rejected["birth_after_reference_date"] += 1
            continue
        age = _age_on(fact.value_time or "", reference_date)
        age_values = sorted(
            {
                _age_on(other.value_time or "", reference_date)
                for other in born
                if other.value_precision == 11
                and "insufficient_precision_for_age" not in other.flags
            }
        )
        alternatives = _numeric_alternatives(age, age_values)
        if alternatives is None:
            rejected["insufficient_age_distractors"] += 1
            continue
        drafts.append(
            Draft(
                ("age_on_date", fact.statement_id, reference_date.isoformat()),
                "age_on_date", "people", "medium",
                _groups_for_person(fact.subject.wikidata_id, memberships),
                (str(age), "number"), alternatives,
                {
                    "person_id": fact.subject.wikidata_id,
                    "born_on": fact.value_time or "",
                    "date": reference_date.isoformat(),
                },
                fact.evidence,
                (fact.statement_id,),
            )
        )

    for group, person, pair_facts in memberships:
        group_options = _entity_alternatives_excluding(
            group,
            groups,
            group_ids_by_person[person.wikidata_id],
        )
        if group_options is None:
            rejected["insufficient_group_distractors"] += 1
        else:
            drafts.append(
                Draft(
                    ("group_for_member", group.wikidata_id, person.wikidata_id),
                    "group_for_member", "members", "medium", (group.wikidata_id,),
                    (group.wikidata_id, "group"), group_options,
                    {"person_id": person.wikidata_id}, _merge_evidence(pair_facts),
                    tuple(sorted(fact.statement_id for fact in pair_facts)),
                )
            )
        dated = _eligible_membership_date(pair_facts)
        if dated is None:
            rejected["membership_interval_not_eligible"] += 1
            continue
        valid_member_ids = {
            candidate.wikidata_id
            for candidate_group, candidate, candidate_facts in memberships
            if candidate_group.wikidata_id == group.wikidata_id
            and _membership_contains_date(candidate_facts, dated)
        }
        person_options = _entity_alternatives_excluding(
            person, people, valid_member_ids
        )
        if person_options is None:
            rejected["insufficient_person_distractors"] += 1
            continue
        drafts.append(
            Draft(
                ("member_at_date", group.wikidata_id, person.wikidata_id, dated),
                "member_at_date", "members", "hard", (group.wikidata_id,),
                (person.wikidata_id, "person"), person_options,
                {"group_id": group.wikidata_id, "date": dated},
                _merge_evidence(pair_facts),
                tuple(sorted(fact.statement_id for fact in pair_facts)),
            )
        )

    for fact in has_members:
        person = fact.value_entity
        if person is None:
            continue
        alternatives = _entity_alternatives_excluding(
            person,
            member_people,
            member_ids_by_group[fact.subject.wikidata_id],
        )
        if alternatives is None:
            rejected["insufficient_nonmember_distractors"] += 1
            continue
        drafts.append(
            Draft(
                ("member_for_group", fact.statement_id),
                "member_for_group", "members", "medium",
                (fact.subject.wikidata_id,),
                (person.wikidata_id, "person"), alternatives,
                {"group_id": fact.subject.wikidata_id}, fact.evidence,
                (fact.statement_id,),
            )
        )

    labels_to_facts: dict[str, list[Fact]] = defaultdict(list)
    label_entities: dict[str, Entity] = {}
    for fact in record_labels:
        if fact.value_entity is not None:
            labels_to_facts[fact.value_entity.wikidata_id].append(fact)
            label_entities[fact.value_entity.wikidata_id] = fact.value_entity
    label_groups = sorted(
        {fact.subject.wikidata_id: fact.subject for fact in record_labels}.values(),
        key=lambda entity: entity.wikidata_id,
    )
    record_label_entities = sorted(
        label_entities.values(), key=lambda entity: entity.wikidata_id
    )
    for label_id in sorted(labels_to_facts):
        label_facts = labels_to_facts[label_id]
        associated_groups = {fact.subject.wikidata_id for fact in label_facts}
        if len(associated_groups) != 1:
            rejected["record_label_has_multiple_groups"] += len(label_facts)
            continue
        fact = label_facts[0]
        alternatives = _entity_alternatives_excluding(
            fact.subject, label_groups, associated_groups
        )
        if alternatives is None:
            rejected["insufficient_record_label_group_distractors"] += 1
            continue
        drafts.append(
            Draft(
                ("group_for_record_label", fact.statement_id),
                "group_for_record_label", "industry", "medium",
                (fact.subject.wikidata_id,),
                (fact.subject.wikidata_id, "group"), alternatives,
                {"record_label_id": label_id}, fact.evidence,
                (fact.statement_id,),
            )
        )

    labels_by_group: dict[str, list[Fact]] = defaultdict(list)
    for fact in record_labels:
        labels_by_group[fact.subject.wikidata_id].append(fact)
    for group_id in sorted(labels_by_group):
        group_facts = labels_by_group[group_id]
        if len(group_facts) != 1:
            rejected["group_has_multiple_record_labels"] += len(group_facts)
            continue
        fact = group_facts[0]
        label = fact.value_entity
        if label is None:
            continue
        alternatives = _entity_alternatives_excluding(
            label, record_label_entities, {label.wikidata_id}
        )
        if alternatives is None:
            rejected["insufficient_record_label_distractors"] += 1
            continue
        drafts.append(
            Draft(
                ("record_label_for_group", fact.statement_id),
                "record_label_for_group", "industry", "easy",
                (fact.subject.wikidata_id,),
                (label.wikidata_id, "organization"), alternatives,
                {"group_id": fact.subject.wikidata_id}, fact.evidence,
                (fact.statement_id,),
            )
        )

    drafts.extend(_comparison_drafts(formed, "group", memberships))
    drafts.extend(_comparison_drafts(born, "person", memberships))
    release_drafts, release_rejections = build_release_drafts(facts)
    drafts.extend(release_drafts)
    rejected.update(release_rejections)
    drafts.sort(key=lambda draft: draft.key)
    return drafts, rejected


def _membership_pairs(facts: list[Fact]) -> list[tuple[Entity, Entity, tuple[Fact, ...]]]:
    sides: dict[tuple[str, str], dict[str, list[Fact]]] = defaultdict(
        lambda: {"has_member": [], "member_of": []}
    )
    for fact in facts:
        if fact.value_entity is None:
            continue
        if fact.predicate == "has_member":
            key = (fact.subject.wikidata_id, fact.value_entity.wikidata_id)
        elif fact.predicate == "member_of":
            key = (fact.value_entity.wikidata_id, fact.subject.wikidata_id)
        else:
            continue
        sides[key][fact.predicate].append(fact)
    result = []
    for key in sorted(sides):
        pair = sides[key]
        if not pair["has_member"] or not pair["member_of"]:
            continue
        group = pair["has_member"][0].subject
        person = pair["has_member"][0].value_entity
        if person is not None:
            result.append((group, person, tuple(pair["has_member"] + pair["member_of"])))
    return result


def _comparison_drafts(
    facts: list[Fact],
    kind: str,
    memberships: list[tuple[Entity, Entity, tuple[Fact, ...]]],
) -> list[Draft]:
    """Build at most one comparison for each fact used as the answer.

    Recombining the same earliest fact with many groups of distractors creates
    different option sets without adding another piece of knowledge.  Keeping
    one nearest-date set per answer makes the logical count reflect distinct
    fact bases.
    """
    result: list[Draft] = []
    for precision in (9, 10, 11):
        usable = sorted(
            (
                fact for fact in facts
                if fact.value_time and fact.value_precision == precision
            ),
            key=lambda fact: (
                fact.value_time or "",
                fact.subject.wikidata_id,
                fact.statement_id,
            ),
        )
        for answer in usable:
            later_by_date: dict[str, Fact] = {}
            for candidate in usable:
                if (candidate.value_time or "") <= (answer.value_time or ""):
                    continue
                later_by_date.setdefault(candidate.value_time or "", candidate)
            later = [later_by_date[value] for value in sorted(later_by_date)[:3]]
            if len(later) < 3:
                continue
            combo = (answer, *later)
            group_ids = (
                tuple(sorted(fact.subject.wikidata_id for fact in combo))
                if kind == "group"
                else tuple(
                    sorted(
                        {
                            group_id
                            for fact in combo
                            for group_id in _groups_for_person(
                                fact.subject.wikidata_id, memberships
                            )
                        }
                    )
                )
            )
            result.append(
                Draft(
                    (
                        "chronological_comparison", kind, answer.statement_id,
                    ),
                    "chronological_comparison", "timeline", "hard", group_ids,
                    (answer.subject.wikidata_id, kind),
                    tuple((fact.subject.wikidata_id, kind) for fact in combo),
                    {
                        "comparison_kind": kind,
                        "date": answer.value_time or "",
                        "date_precision": str(precision),
                        "comparison_values": tuple(
                            (
                                fact.subject.wikidata_id,
                                fact.value_time or "",
                                precision,
                            )
                            for fact in combo
                        ),
                    },
                    _merge_evidence(combo),
                    tuple(sorted(fact.statement_id for fact in combo)),
                )
            )
    return result


def _time_alternatives(fact: Fact, candidates: list[Fact]) -> tuple[tuple[str, str], ...] | None:
    values = sorted(
        {
            item.value_time
            for item in candidates
            if item.value_precision == fact.value_precision and item.value_time
        },
        key=lambda value: (_date_distance(value, fact.value_time or ""), value),
    )
    if len(values) < 4:
        return None
    selected = [fact.value_time or ""] + [value for value in values if value != fact.value_time][:3]
    return tuple((value, "time") for value in selected)


def _year_alternatives(fact: Fact, candidates: list[Fact]) -> tuple[tuple[str, str], ...] | None:
    answer = (fact.value_time or "")[:4]
    values = sorted(
        {(item.value_time or "")[:4] for item in candidates if item.value_time},
        key=lambda value: (abs(int(value) - int(answer)), value),
    )
    if len(values) < 4:
        return None
    selected = [answer] + [value for value in values if value != answer][:3]
    return tuple((value, "time") for value in selected)


def _numeric_alternatives(value: int, values: list[int]) -> tuple[tuple[str, str], ...] | None:
    ordered = sorted((item for item in values if item != value), key=lambda item: (abs(item - value), item))
    if len(ordered) < 3:
        return None
    return tuple((str(item), "number") for item in [value, *ordered[:3]])


def _entity_alternatives(
    answer: Entity, pool: list[Entity]
) -> tuple[tuple[str, str], ...] | None:
    others = [entity for entity in pool if entity.wikidata_id != answer.wikidata_id]
    if len(others) < 3:
        return None
    ranked = sorted(others, key=lambda entity: digest(answer.wikidata_id, entity.wikidata_id))
    return tuple(
        (entity.wikidata_id, answer.entity_type) for entity in [answer, *ranked[:3]]
    )


def _entity_alternatives_excluding(
    answer: Entity,
    pool: list[Entity],
    excluded_ids: set[str],
) -> tuple[tuple[str, str], ...] | None:
    """Choose typed distractors that are not other valid answers to the prompt."""
    others = [
        entity
        for entity in pool
        if entity.wikidata_id != answer.wikidata_id
        and entity.wikidata_id not in excluded_ids
    ]
    if len(others) < 3:
        return None
    ranked = sorted(
        others,
        key=lambda entity: digest(answer.wikidata_id, entity.wikidata_id),
    )
    return tuple(
        (entity.wikidata_id, answer.entity_type)
        for entity in [answer, *ranked[:3]]
    )


def _eligible_membership_date(facts: tuple[Fact, ...]) -> str | None:
    intervals: list[tuple[str, str]] = []
    for fact in facts:
        if "validity_not_evidenced" in fact.flags:
            return None
        if not (
            fact.valid_from and fact.valid_to
            and fact.valid_from_precision == 11 and fact.valid_to_precision == 11
        ):
            return None
        intervals.append((fact.valid_from, fact.valid_to))
    if not intervals or len(set(intervals)) != 1:
        return None
    start = date.fromisoformat(intervals[0][0])
    end = date.fromisoformat(intervals[0][1])
    if end < start:
        return None
    return start.isoformat() if start == end else date.fromordinal(
        (start.toordinal() + end.toordinal()) // 2
    ).isoformat()


def _membership_contains_date(facts: tuple[Fact, ...], value: str) -> bool:
    """Return whether bilateral, fully evidenced intervals contain a date."""
    if _eligible_membership_date(facts) is None:
        return False
    intervals = {(fact.valid_from, fact.valid_to) for fact in facts}
    start, end = next(iter(intervals))
    return bool(start and end and start <= value <= end)


def _groups_for_person(
    person_id: str,
    memberships: list[tuple[Entity, Entity, tuple[Fact, ...]]],
) -> tuple[str, ...]:
    return tuple(
        sorted(group.wikidata_id for group, person, _facts in memberships if person.wikidata_id == person_id)
    )


def _age_on(born_on: str, reference_date: date) -> int:
    born = date.fromisoformat(born_on)
    return reference_date.year - born.year - (
        (reference_date.month, reference_date.day) < (born.month, born.day)
    )


def _date_distance(first: str, second: str) -> int:
    return abs(int(first[:4]) - int(second[:4]))


def _merge_evidence(facts: Iterable[Fact]) -> tuple[Evidence, ...]:
    unique = {
        (
            item.fact_base_id,
            item.source_url,
            item.locator,
            item.source_key,
            item.revision_id,
        ): item
        for fact in facts
        for item in fact.evidence
    }
    return tuple(unique[key] for key in sorted(unique))
