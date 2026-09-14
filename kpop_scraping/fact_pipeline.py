"""Coordinate Wikidata collection, fact extraction, validation and persistence."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from itertools import islice

from .catalog import MUSICAL_GROUP_CLASSES
from .entities import extract_aliases, instance_of, matching_names
from .evidence import WikipediaPage
from .fact_store import CatalogGroup, FactRunTotals, FactStore, count_statuses
from .facts import (
    ExtractedFacts,
    FactCandidate,
    country_value_ids,
    group_fact_candidates,
    member_ids,
    person_fact_candidates,
)
from .storage import Repository
from .validation import ValidationContext, validate_facts
from .wikidata import (
    COUNTRY_PROFILE,
    LABEL_PROFILE,
    MAX_ENTITIES_PER_REQUEST,
    SUBJECT_PROFILE,
    EntityDocument,
    EntityProfile,
    WikidataEntityClient,
)


EXTRACTOR_VERSION = "wikidata-facts-v2"
HUMAN = "Q5"
COUNTRY_CLASSES = frozenset(
    {
        "Q6256",  # country
        "Q3624078",  # sovereign state
        "Q7275",  # state
        "Q15634554",  # state with limited recognition
        "Q1763527",  # constituent country
        "Q112099",  # island nation
    }
)


@dataclass
class _Subject:
    wikidata_id: str
    entity_id: int
    snapshot_id: int
    candidates: tuple[FactCandidate, ...]


@dataclass
class _RunState:
    entity_ids: dict[str, int] = field(default_factory=dict)
    entity_types: dict[str, str] = field(default_factory=dict)
    names: dict[str, tuple[str, ...]] = field(default_factory=dict)
    subjects: list[_Subject] = field(default_factory=list)
    batches: int = 0
    ignored: int = 0


def _batched(values: Iterable[str], size: int) -> Iterator[list[str]]:
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def extract_facts(
    repository: Repository,
    client: WikidataEntityClient,
    group_limit: int | None = None,
    batch_size: int = MAX_ENTITIES_PER_REQUEST,
) -> FactRunTotals:
    """Extract facts for accepted catalog groups and commit them atomically."""
    if group_limit is not None and group_limit < 1:
        raise ValueError("group_limit must be greater than zero")
    if not 1 <= batch_size <= MAX_ENTITIES_PER_REQUEST:
        raise ValueError(f"batch_size must be between 1 and {MAX_ENTITIES_PER_REQUEST}")
    store = FactStore(repository)
    run_id = store.start_run(EXTRACTOR_VERSION, group_limit)
    try:
        totals = _Run(store, client, run_id, batch_size).execute(group_limit)
        missing_evidence = store.accepted_facts_without_evidence()
        if missing_evidence:
            raise RuntimeError(f"{missing_evidence} accepted facts have no evidence")
    except Exception as exc:
        store.fail_run(run_id, str(exc))
        raise
    store.complete_run(run_id, totals)
    return totals


class _Run:
    def __init__(
        self,
        store: FactStore,
        client: WikidataEntityClient,
        run_id: int,
        batch_size: int,
    ) -> None:
        self.store = store
        self.client = client
        self.run_id = run_id
        self.batch_size = batch_size
        self.state = _RunState()

    def execute(self, group_limit: int | None) -> FactRunTotals:
        state = self.state
        catalog = self.store.accepted_groups()
        catalog_by_id = {group.wikidata_id: group for group in catalog}
        groups = catalog if group_limit is None else catalog[:group_limit]
        known_groups = set(catalog_by_id)

        processed_groups = self._process_groups(groups)
        group_candidates = [c for subject in state.subjects for c in subject.candidates]
        self._process_members(member_ids(group_candidates), known_groups)
        all_candidates = [c for subject in state.subjects for c in subject.candidates]

        # Groups linked by member_of but outside the limit are fetched so that
        # both sides of each membership are compared in this run.
        reference_candidates = self._reference_groups(
            all_candidates, processed_groups, catalog_by_id
        )
        countries = self._resolve_values(all_candidates)
        pages = self._pages(processed_groups, all_candidates)

        context = ValidationContext(
            names=state.names,
            entity_types=state.entity_types,
            group_pages=pages,
            countries=frozenset(countries),
        )
        decisions = validate_facts(all_candidates, context, reference_candidates)
        by_statement = {d.candidate.statement.statement_id: d for d in decisions}
        for subject in state.subjects:
            self.store.save_facts(
                self.run_id,
                EXTRACTOR_VERSION,
                subject.entity_id,
                subject.snapshot_id,
                [by_statement[c.statement.statement_id] for c in subject.candidates],
                state.entity_ids,
            )
        processed_page_ids = {
            catalog_by_id[requested_id].source_page_id
            for requested_id in processed_groups
            if requested_id in catalog_by_id
        }
        unavailable_page_ids = {
            group.source_page_id
            for group in groups
            if group.source_page_id not in processed_page_ids
        }
        stale = self.store.mark_catalog_subjects_stale(
            self.run_id, unavailable_page_ids
        )
        stale += self.store.mark_stale_facts(self.run_id)

        totals = count_statuses(decisions)
        return FactRunTotals(
            groups=len(processed_groups),
            entities=len(set(state.entity_ids.values())),
            batches=state.batches,
            accepted=totals["accepted"],
            rejected=totals["rejected"],
            conflict=totals["conflict"],
            superseded=totals["superseded"],
            ignored=state.ignored,
            stale=stale,
        )

    def _fetch(
        self,
        ids: list[str],
        profile: EntityProfile,
    ) -> dict[str, tuple[EntityDocument, int]]:
        found: dict[str, tuple[EntityDocument, int]] = {}
        for batch in _batched(ids, self.batch_size):
            result = self.client.get_entities(batch, profile)
            self.state.batches += 1
            for document in result.documents:
                snapshot_id = self.store.save_entity_snapshot(
                    self.run_id, document, profile.name
                )
                found[document.requested_id] = (document, snapshot_id)
                if document.redirected:
                    self.store.record_issue(
                        self.run_id,
                        document.requested_id,
                        "entity_redirected",
                        f"resolved to {document.wikidata_id}",
                    )
            for missing_id in result.missing:
                self.store.record_issue(
                    self.run_id, missing_id, "entity_missing", "Wikidata returned no entity"
                )
        return found

    def _register(
        self,
        requested_id: str,
        document: EntityDocument,
        snapshot_id: int,
        profile: EntityProfile,
        entity_type: str,
        source_page_id: int | None = None,
    ) -> int:
        entity_id, stored_type = self.store.save_entity(
            document, snapshot_id, profile.name, entity_type, source_page_id
        )
        names = matching_names(extract_aliases(document.payload))
        for key in {requested_id, document.wikidata_id}:
            self.state.entity_ids[key] = entity_id
            self.state.entity_types[key] = stored_type
            self.state.names[key] = names
        return entity_id

    def _add_subject(
        self,
        document: EntityDocument,
        entity_id: int,
        snapshot_id: int,
        extracted: ExtractedFacts,
    ) -> None:
        self.state.ignored += extracted.ignored
        for issue in extracted.issues:
            self.store.record_issue(
                self.run_id,
                document.wikidata_id,
                "malformed_statement",
                f"{issue.property_id} {issue.statement_id or '-'}: {issue.detail}",
            )
        self.state.subjects.append(
            _Subject(document.wikidata_id, entity_id, snapshot_id, extracted.candidates)
        )

    def _process_groups(self, groups: list[CatalogGroup]) -> dict[str, str]:
        documents = self._fetch([group.wikidata_id for group in groups], SUBJECT_PROFILE)
        processed: dict[str, str] = {}
        for group in groups:
            if group.wikidata_id not in documents:
                continue
            document, snapshot_id = documents[group.wikidata_id]
            if document.wikidata_id in processed.values():
                self.store.link_catalog_entity(
                    self.run_id,
                    group.source_page_id,
                    group.wikidata_id,
                    document.wikidata_id,
                    self.state.entity_ids[document.wikidata_id],
                )
                self.store.record_issue(
                    self.run_id,
                    group.wikidata_id,
                    "duplicate_subject",
                    f"{document.wikidata_id} was already processed in this run",
                )
                continue
            entity_id = self._register(
                group.wikidata_id,
                document,
                snapshot_id,
                SUBJECT_PROFILE,
                "group",
                group.source_page_id,
            )
            self.store.link_catalog_entity(
                self.run_id,
                group.source_page_id,
                group.wikidata_id,
                document.wikidata_id,
                entity_id,
            )
            self._add_subject(
                document,
                entity_id,
                snapshot_id,
                group_fact_candidates(document.wikidata_id, document.payload),
            )
            processed[group.wikidata_id] = document.wikidata_id
        return processed

    def _process_members(self, member_qids: list[str], known_groups: set[str]) -> None:
        members = [qid for qid in member_qids if qid not in self.state.entity_ids]
        documents = self._fetch(members, SUBJECT_PROFILE)
        for qid in members:
            if qid not in documents:
                continue
            document, snapshot_id = documents[qid]
            classes = instance_of(document.payload)
            if HUMAN in classes:
                entity_id = self._register(qid, document, snapshot_id, SUBJECT_PROFILE, "person")
                self._add_subject(
                    document,
                    entity_id,
                    snapshot_id,
                    person_fact_candidates(document.wikidata_id, document.payload, known_groups),
                )
            elif classes & MUSICAL_GROUP_CLASSES:
                self._register(qid, document, snapshot_id, SUBJECT_PROFILE, "group")
            else:
                # Parts that are neither people nor groups do not become entities.
                self.state.entity_types[qid] = "unsupported"

    def _reference_groups(
        self,
        candidates: list[FactCandidate],
        processed_groups: dict[str, str],
        catalog_by_id: dict[str, CatalogGroup],
    ) -> list[FactCandidate]:
        processed = set(processed_groups) | set(processed_groups.values())
        targets = sorted(
            {
                candidate.value_id
                for candidate in candidates
                if candidate.predicate == "member_of"
                and candidate.value_id
                and candidate.value_id not in processed
            }
        )
        documents = self._fetch(targets, SUBJECT_PROFILE)
        references: list[FactCandidate] = []
        for qid in targets:
            if qid not in documents:
                continue
            document, snapshot_id = documents[qid]
            catalog_group = catalog_by_id.get(qid)
            self._register(
                qid,
                document,
                snapshot_id,
                SUBJECT_PROFILE,
                "group",
                catalog_group.source_page_id if catalog_group else None,
            )
            extracted = group_fact_candidates(document.wikidata_id, document.payload)
            for issue in extracted.issues:
                self.store.record_issue(
                    self.run_id,
                    document.wikidata_id,
                    "malformed_statement",
                    f"{issue.property_id} {issue.statement_id or '-'}: {issue.detail}",
                )
            references.extend(c for c in extracted.candidates if c.predicate == "has_member")
        return references

    def _resolve_values(self, candidates: list[FactCandidate]) -> set[str]:
        """Fetch value entities and return the QIDs whose P31 is a country class."""
        state = self.state
        country_ids = sorted(country_value_ids(candidates) - set(state.entity_types))
        country_documents = self._fetch(country_ids, COUNTRY_PROFILE)
        countries: set[str] = set()
        for qid in country_ids:
            if qid not in country_documents:
                continue
            document, snapshot_id = country_documents[qid]
            self._register(qid, document, snapshot_id, COUNTRY_PROFILE, "place")
            if instance_of(document.payload) & COUNTRY_CLASSES:
                countries.update({qid, document.wikidata_id})

        value_roles: dict[str, str] = {}
        for candidate in candidates:
            value_type = candidate.spec.value_entity_type
            if (
                candidate.value_id
                and value_type not in {None, "person"}
                and candidate.value_id not in state.entity_types
            ):
                value_roles.setdefault(candidate.value_id, value_type)
        value_ids = sorted(value_roles)
        label_documents = self._fetch(value_ids, LABEL_PROFILE)
        for qid in value_ids:
            if qid in label_documents:
                document, snapshot_id = label_documents[qid]
                self._register(qid, document, snapshot_id, LABEL_PROFILE, value_roles[qid])
        return countries

    def _pages(
        self,
        processed_groups: dict[str, str],
        candidates: list[FactCandidate],
    ) -> dict[str, WikipediaPage]:
        # Evidence pages are keyed by the catalog QID and by its resolved QID.
        page_keys = dict(processed_groups)
        for candidate in candidates:
            if candidate.predicate == "member_of" and candidate.value_id:
                page_keys.setdefault(candidate.value_id, candidate.value_id)
        pages: dict[str, WikipediaPage] = {}
        for catalog_id in sorted(page_keys):
            page = self.store.group_page(catalog_id)
            if page is not None:
                pages[catalog_id] = page
                pages.setdefault(page_keys[catalog_id], page)
        return pages
