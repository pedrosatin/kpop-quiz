"""Confirm discovered releases and persist cited facts from direct snapshots."""

from __future__ import annotations

from collections import defaultdict

from .catalog import MUSICAL_GROUP_CLASSES
from .entities import extract_aliases, instance_of, matching_names
from .fact_store import FactRunTotals, FactStore, count_statuses
from .release_facts import EXTRACTOR_VERSION, release_entity_type, release_fact_candidates
from .validation import ValidationContext, validate_facts
from .wikidata import LABEL_PROFILE, SUBJECT_PROFILE, WikidataEntityClient


def collect_release_facts(
    repository,
    client: WikidataEntityClient,
    discovery_run_id: int,
    batch_size: int = 25,
) -> FactRunTotals:
    if not 1 <= batch_size <= 50:
        raise ValueError("batch_size must be between 1 and 50")
    scoped_group_ids = _completed_discovery_scope(repository, discovery_run_id)
    store = FactStore(repository)
    run_id = store.start_run(EXTRACTOR_VERSION, None)
    try:
        totals = _collect(
            repository,
            store,
            client,
            discovery_run_id,
            run_id,
            batch_size,
            scoped_group_ids,
        )
        if store.accepted_facts_without_evidence():
            raise RuntimeError("accepted release facts have no evidence")
    except Exception as exc:
        store.fail_run(run_id, str(exc))
        raise
    store.complete_run(run_id, totals)
    return totals


def _completed_discovery_scope(repository, discovery_run_id: int) -> frozenset[int]:
    run = repository.connection.execute(
        "SELECT status FROM release_discovery_runs WHERE id=?", (discovery_run_id,)
    ).fetchone()
    if run is None:
        raise ValueError(f"release discovery run {discovery_run_id} does not exist")
    if run["status"] != "completed":
        raise ValueError(
            f"release discovery run {discovery_run_id} is not completed"
        )
    group_ids = frozenset(
        int(row["group_entity_id"])
        for row in repository.connection.execute(
            "SELECT group_entity_id FROM release_discovery_groups WHERE run_id=?",
            (discovery_run_id,),
        )
    )
    if not group_ids:
        raise ValueError(f"release discovery run {discovery_run_id} has no groups")
    return group_ids


def _collect(
    repository,
    store,
    client,
    discovery_run_id,
    run_id,
    batch_size,
    scoped_group_ids,
):
    rows = repository.connection.execute(
        """
        SELECT rc.id, rc.requested_wikidata_id, rc.group_entity_id,
               g.wikidata_id AS group_qid
        FROM release_candidates rc JOIN entities g ON g.id=rc.group_entity_id
        JOIN release_discovery_runs r ON r.id=rc.run_id
        WHERE rc.run_id=? AND r.status='completed' ORDER BY rc.requested_wikidata_id,g.wikidata_id
        """,
        (discovery_run_id,),
    ).fetchall()
    candidate_rows = defaultdict(list)
    for row in rows:
        candidate_rows[row["requested_wikidata_id"]].append(row)
    accepted_groups = {
        row["wikidata_id"]: int(row["id"])
        for row in repository.connection.execute(
            """SELECT DISTINCT e.id,e.wikidata_id FROM entities e
            JOIN catalog_entity_links cel ON cel.entity_id=e.id
            JOIN catalog_entries ce ON ce.source_page_id=cel.source_page_id
            WHERE e.entity_type='group' AND ce.state='accepted'"""
        )
    }
    entity_ids = dict(accepted_groups)
    entity_types = {qid: "group" for qid in accepted_groups}
    names: dict[str, tuple[str, ...]] = {}
    subjects = []
    batches = ignored = 0
    requested = sorted(candidate_rows)
    for offset in range(0, len(requested), batch_size):
        batch = requested[offset : offset + batch_size]
        response = client.get_entities(batch, SUBJECT_PROFILE)
        batches += 1
        found = {doc.requested_id: doc for doc in response.documents}
        for qid in batch:
            document = found.get(qid)
            if document is None:
                _reject(repository, candidate_rows[qid], "entity_missing")
                continue
            snapshot_id = store.save_entity_snapshot(run_id, document, SUBJECT_PROFILE.name)
            kind = release_entity_type(document.payload)
            if kind is None:
                _reject(repository, candidate_rows[qid], "release_class_not_allowed", document.wikidata_id, snapshot_id)
                continue
            extracted = release_fact_candidates(document.wikidata_id, document.payload)
            entity_id, _ = store.save_entity(document, snapshot_id, SUBJECT_PROFILE.name, kind)
            for key in {qid, document.wikidata_id}:
                entity_ids[key] = entity_id
                entity_types[key] = kind
                names[key] = matching_names(extract_aliases(document.payload))
            subjects.append((entity_id, snapshot_id, document.wikidata_id, extracted))
            repository.connection.executemany(
                "UPDATE release_candidates SET resolved_wikidata_id=?,entity_id=?,snapshot_id=? WHERE id=?",
                [(document.wikidata_id, entity_id, snapshot_id, row["id"]) for row in candidate_rows[qid]],
            )
            ignored += extracted.ignored
    value_roles = {}
    for _entity_id, _snapshot_id, _qid, extracted in subjects:
        for candidate in extracted.candidates:
            if candidate.value_id and candidate.value_id not in entity_types:
                value_roles.setdefault(candidate.value_id, candidate.spec.value_entity_type or "genre")
    performer_ids = sorted(qid for qid, role in value_roles.items() if role == "group")
    for offset in range(0, len(performer_ids), batch_size):
        batch = performer_ids[offset : offset + batch_size]
        response = client.get_entities(batch, SUBJECT_PROFILE)
        batches += 1
        for document in response.documents:
            if not matching_names(extract_aliases(document.payload)) or not (
                instance_of(document.payload) & MUSICAL_GROUP_CLASSES
            ):
                entity_types[document.requested_id] = "unsupported"
                continue
            snapshot_id = store.save_entity_snapshot(run_id, document, SUBJECT_PROFILE.name)
            entity_id, stored = store.save_entity(document, snapshot_id, SUBJECT_PROFILE.name, "group")
            for key in {document.requested_id, document.wikidata_id}:
                entity_ids[key] = entity_id
                entity_types[key] = stored
                names[key] = matching_names(extract_aliases(document.payload))
    for qid, rows_for_qid in candidate_rows.items():
        subject = next((item for item in subjects if item[0] == entity_ids.get(qid)), None)
        if subject is None:
            continue
        performer_entity_ids = _performer_entity_ids(subject[3], entity_ids)
        for row in rows_for_qid:
            accepted = int(row["group_entity_id"]) in performer_entity_ids
            repository.connection.execute(
                "UPDATE release_candidates SET state=?,reason=? WHERE id=?",
                ("accepted" if accepted else "rejected", None if accepted else "catalog_performer_not_confirmed", row["id"]),
            )
    label_ids = sorted(qid for qid, role in value_roles.items() if role != "group")
    for offset in range(0, len(label_ids), batch_size):
        batch = label_ids[offset : offset + batch_size]
        response = client.get_entities(batch, LABEL_PROFILE)
        batches += 1
        for document in response.documents:
            snapshot_id = store.save_entity_snapshot(run_id, document, LABEL_PROFILE.name)
            entity_id, stored = store.save_entity(document, snapshot_id, LABEL_PROFILE.name, value_roles[document.requested_id])
            for key in {document.requested_id, document.wikidata_id}:
                entity_ids[key] = entity_id
                entity_types[key] = stored
                names[key] = matching_names(extract_aliases(document.payload))
    decisions = []
    context = ValidationContext(names=names, entity_types=entity_types, group_pages={})
    for entity_id, snapshot_id, _qid, extracted in subjects:
        current = validate_facts(extracted.candidates, context)
        store.save_facts(run_id, EXTRACTOR_VERSION, entity_id, snapshot_id, current, entity_ids)
        decisions.extend(current)
    repository.connection.execute(
        """UPDATE release_candidates AS rc SET state='rejected',reason='performed_by_not_accepted'
        WHERE rc.run_id=? AND rc.state='accepted' AND NOT EXISTS (
            SELECT 1 FROM facts f WHERE f.subject_entity_id=rc.entity_id
              AND f.value_entity_id=rc.group_entity_id
              AND f.predicate='performed_by' AND f.status='accepted'
        )""",
        (discovery_run_id,),
    )
    _mark_stale_releases(repository.connection, discovery_run_id, run_id)
    repository.connection.execute(
        """UPDATE release_discovery_runs SET
        candidates_accepted=(SELECT COUNT(*) FROM release_candidates WHERE run_id=? AND state='accepted'),
        candidates_rejected=(SELECT COUNT(*) FROM release_candidates WHERE run_id=? AND state='rejected') WHERE id=?""",
        (discovery_run_id, discovery_run_id, discovery_run_id),
    )
    counts = count_statuses(decisions)
    release_entity_ids = {entity_id for entity_id, _snapshot_id, _qid, _extracted in subjects}
    return FactRunTotals(
        len(scoped_group_ids),
        len(release_entity_ids),
        batches,
        counts["accepted"],
        counts["rejected"],
        counts["conflict"],
        counts["superseded"],
        ignored,
    )


def _mark_stale_releases(connection, discovery_run_id: int, fact_run_id: int) -> None:
    connection.execute(
        """UPDATE release_candidates AS previous
        SET state='stale',reason='not_in_latest_discovery'
        WHERE previous.run_id<>? AND previous.state='accepted'
          AND previous.group_entity_id IN (
              SELECT group_entity_id FROM release_discovery_groups WHERE run_id=?
          )
          AND NOT EXISTS (
              SELECT 1 FROM release_candidates current
              WHERE current.run_id=? AND current.group_entity_id=previous.group_entity_id
                AND current.resolved_wikidata_id=previous.resolved_wikidata_id
                AND current.state='accepted'
          )""",
        (discovery_run_id, discovery_run_id, discovery_run_id),
    )
    connection.execute(
        """UPDATE facts SET status='stale',status_reason='release_not_in_latest_discovery',fact_run_id=?
        WHERE status='accepted' AND subject_entity_id IN (
            SELECT DISTINCT previous.entity_id FROM release_candidates previous
            WHERE previous.run_id<>? AND previous.entity_id IS NOT NULL
              AND previous.group_entity_id IN (SELECT group_entity_id FROM release_discovery_groups WHERE run_id=?)
              AND NOT EXISTS (
                SELECT 1 FROM release_candidates current
                WHERE current.run_id=? AND current.entity_id=previous.entity_id AND current.state='accepted'
              )
              AND NOT EXISTS (
                SELECT 1 FROM release_candidates outside_scope
                WHERE outside_scope.entity_id=previous.entity_id AND outside_scope.state='accepted'
                  AND outside_scope.group_entity_id NOT IN (SELECT group_entity_id FROM release_discovery_groups WHERE run_id=?)
              )
        )""",
        (
            fact_run_id,
            discovery_run_id,
            discovery_run_id,
            discovery_run_id,
            discovery_run_id,
        ),
    )


def _reject(repository, rows, reason, resolved=None, snapshot_id=None):
    repository.connection.executemany(
        "UPDATE release_candidates SET state='rejected',reason=?,resolved_wikidata_id=?,snapshot_id=? WHERE id=?",
        [(reason, resolved, snapshot_id, row["id"]) for row in rows],
    )


def _performer_entity_ids(extracted, entity_ids):
    """Resolve P175 values to stored identities before matching catalog groups."""
    return {
        entity_ids[candidate.value_id]
        for candidate in extracted.candidates
        if candidate.predicate == "performed_by" and candidate.value_id in entity_ids
    }
