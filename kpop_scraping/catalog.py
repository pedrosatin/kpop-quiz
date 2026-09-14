"""Deterministic classification of Wikipedia pages into a group catalog."""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from itertools import islice

from .storage import Repository
from .wikidata import MAX_ENTITIES_PER_REQUEST, TypeCheck, WikidataTypeClient


CLASSIFIER_VERSION = "group-catalog-v1"
MUSICAL_GROUP_CLASSES = frozenset(
    {
        "Q215380",  # musical group
        "Q216337",  # boy band
        "Q641066",  # girl group
        "Q2088357",  # musical ensemble
        "Q9212979",  # musical duo
        "Q5741069",  # rock band
    }
)
_QID = re.compile(r"^Q[1-9][0-9]*$")
_LIST_TITLE = re.compile(r"^lists?\s+of\b", re.IGNORECASE)


@dataclass(frozen=True)
class CatalogStats:
    accepted: int
    rejected: int
    pending: int


def _batched(values: Iterable[str], size: int) -> Iterator[list[str]]:
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def _local_rejection(entry: object) -> str | None:
    if _LIST_TITLE.match(entry["title"].strip()):
        return "list_page"
    if entry["is_disambiguation"]:
        return "disambiguation_page"
    if entry["is_redirect"]:
        return "redirect_page"
    wikidata_id = entry["wikidata_id"]
    if not wikidata_id or not _QID.fullmatch(wikidata_id):
        return "missing_or_invalid_wikidata_id"
    return None


def classify_catalog(
    repository: Repository,
    client: WikidataTypeClient,
) -> CatalogStats:
    """Classify current rows and commit all decisions as one transaction."""
    run_id = repository.start_catalog_run(CLASSIFIER_VERSION)
    entries = repository.catalog_entries_for_classification()
    remote_entries = []
    try:
        for entry in entries:
            reason = _local_rejection(entry)
            if reason is None:
                remote_entries.append(entry)
                continue
            repository.set_catalog_decision(
                entry["source_page_id"],
                entry["source_revision_id"],
                "rejected",
                CLASSIFIER_VERSION,
                rejection_reason=reason,
            )

        checks: dict[str, TypeCheck] = {}
        wikidata_ids = [entry["wikidata_id"] for entry in remote_entries]
        for batch in _batched(wikidata_ids, MAX_ENTITIES_PER_REQUEST):
            checks.update(
                (check.wikidata_id, check)
                for check in client.get_type_checks(batch)
            )

        for entry in remote_entries:
            check = checks.get(entry["wikidata_id"])
            if check is None:
                repository.set_catalog_decision(
                    entry["source_page_id"],
                    entry["source_revision_id"],
                    "rejected",
                    CLASSIFIER_VERSION,
                    rejection_reason="wikidata_entity_missing",
                )
                continue
            type_check_id = repository.save_type_check(
                check.wikidata_id,
                check.revision_id,
                check.instance_of,
            )
            compatible = bool(MUSICAL_GROUP_CLASSES.intersection(check.instance_of))
            repository.set_catalog_decision(
                entry["source_page_id"],
                entry["source_revision_id"],
                "accepted" if compatible else "rejected",
                CLASSIFIER_VERSION,
                rejection_reason=None if compatible else "incompatible_wikidata_instance",
                type_check_id=type_check_id,
            )
    except Exception as exc:
        repository.fail_catalog_run(run_id, str(exc))
        raise

    totals = {
        row["state"]: row["total"]
        for row in repository.connection.execute(
            "SELECT state, COUNT(*) AS total FROM catalog_entries GROUP BY state"
        )
    }
    stats = CatalogStats(
        accepted=totals.get("accepted", 0),
        rejected=totals.get("rejected", 0),
        pending=totals.get("candidate", 0),
    )
    repository.complete_catalog_run(
        run_id,
        stats.accepted,
        stats.rejected,
        stats.pending,
    )
    return stats
