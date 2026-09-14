"""Build unambiguous quiz drafts for accepted release facts."""

from __future__ import annotations

from collections import Counter, defaultdict

from .quiz_models import Draft, Entity, Fact
from .quiz_utils import digest


def build_release_drafts(facts: list[Fact]) -> tuple[list[Draft], Counter[str]]:
    rejected: Counter[str] = Counter()
    performed = [fact for fact in facts if fact.predicate == "performed_by" and fact.value_entity]
    dates = [fact for fact in facts if fact.predicate == "released_on" and fact.value_time]
    performers_by_release: dict[str, list[Fact]] = defaultdict(list)
    releases_by_group: dict[str, list[Fact]] = defaultdict(list)
    for fact in performed:
        performers_by_release[fact.subject.wikidata_id].append(fact)
        releases_by_group[fact.value_entity.wikidata_id].append(fact)
    scoped_dates = [fact for fact in dates if fact.subject.wikidata_id in performers_by_release]
    releases = sorted({f.subject.wikidata_id: f.subject for f in performed}.values(), key=lambda e: e.wikidata_id)
    groups = sorted({f.value_entity.wikidata_id: f.value_entity for f in performed}.values(), key=lambda e: e.wikidata_id)
    drafts: list[Draft] = []
    for group_id in sorted(releases_by_group):
        correct_ids = {fact.subject.wikidata_id for fact in releases_by_group[group_id]}
        for fact in releases_by_group[group_id]:
            alternatives = _entities(fact.subject, releases, correct_ids)
            if alternatives is None:
                rejected["insufficient_release_distractors"] += 1
                continue
            drafts.append(Draft(
                ("release_for_group", fact.statement_id), "release_for_group", "discography", "easy",
                (group_id,), (fact.subject.wikidata_id, fact.subject.entity_type), alternatives,
                {"group_id": group_id, "release_kind": fact.subject.entity_type}, fact.evidence,
                (fact.statement_id,),
            ))
    for release_id in sorted(performers_by_release):
        correct_ids = {f.value_entity.wikidata_id for f in performers_by_release[release_id]}
        for fact in performers_by_release[release_id]:
            alternatives = _entities(fact.value_entity, groups, correct_ids)
            if alternatives is None:
                rejected["insufficient_performer_distractors"] += 1
                continue
            drafts.append(Draft(
                ("group_for_release", fact.statement_id), "group_for_release", "discography",
                "medium" if len(correct_ids) > 1 else "easy", tuple(sorted(correct_ids)),
                (fact.value_entity.wikidata_id, "group"), alternatives,
                {"release_id": release_id, "release_kind": fact.subject.entity_type}, fact.evidence,
                (fact.statement_id,),
            ))
    for fact in scoped_dates:
        same_precision = [other for other in scoped_dates if other.value_precision == fact.value_precision]
        years = sorted({(other.value_time or "")[:4] for other in same_precision})
        answer = (fact.value_time or "")[:4]
        others = sorted((year for year in years if year != answer), key=lambda y: (abs(int(y)-int(answer)), y))
        if len(others) < 3:
            rejected["insufficient_release_year_distractors"] += 1
            continue
        scope = performers_by_release[fact.subject.wikidata_id]
        drafts.append(Draft(
            ("release_year", fact.statement_id), "release_year", "discography", "easy",
            tuple(sorted(f.value_entity.wikidata_id for f in scope)), (answer, "time"),
            tuple((year, "time") for year in (answer, *others[:3])),
            {"release_id": fact.subject.wikidata_id, "release_kind": fact.subject.entity_type},
            _evidence((fact, *scope)), tuple(sorted(f.statement_id for f in (fact, *scope))),
        ))
    for precision in (9, 10, 11):
        usable = sorted((f for f in scoped_dates if f.value_precision == precision), key=lambda f: (f.value_time or "", f.subject.wikidata_id))
        for answer in usable:
            later_by_date = {}
            for candidate in usable:
                if (candidate.value_time or "") > (answer.value_time or ""):
                    later_by_date.setdefault(candidate.value_time, candidate)
            later = [later_by_date[key] for key in sorted(later_by_date)[:3]]
            if len(later) < 3:
                continue
            combo = (answer, *later)
            scope = tuple(f for item in combo for f in performers_by_release[item.subject.wikidata_id])
            all_facts = (*combo, *scope)
            drafts.append(Draft(
                ("earliest_release", answer.statement_id), "earliest_release", "discography", "hard",
                tuple(sorted({f.value_entity.wikidata_id for f in scope})),
                (answer.subject.wikidata_id, answer.subject.entity_type),
                tuple((f.subject.wikidata_id, f.subject.entity_type) for f in combo),
                {"release_kind": answer.subject.entity_type}, _evidence(all_facts),
                tuple(sorted(f.statement_id for f in all_facts)),
            ))
    drafts.sort(key=lambda draft: draft.key)
    return drafts, rejected


def _entities(answer: Entity, pool: list[Entity], excluded: set[str]):
    others = [item for item in pool if item.wikidata_id not in excluded and item.canonical_name != answer.canonical_name]
    if len(others) < 3:
        return None
    ranked = sorted(others, key=lambda item: digest(answer.wikidata_id, item.wikidata_id))
    return tuple((item.wikidata_id, item.entity_type) for item in (answer, *ranked[:3]))


def _evidence(facts):
    return tuple({(e.fact_base_id, e.source_url, e.locator): e for f in facts for e in f.evidence}[key] for key in sorted({(e.fact_base_id, e.source_url, e.locator) for f in facts for e in f.evidence}))
