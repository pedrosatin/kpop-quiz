"""Serve unchanged Wikidata revisions from stored snapshots in the incremental rebuild.

A full rebuild downloads every entity document again, although most of them
are at a revision it already stored. With ``python main.py --incremental``
the CLI wraps its Wikidata client in :class:`IncrementalWikidataClient`:

1. a ``props=info`` request (phase ``revisions``) gives the current QID and
   ``lastrevid`` of up to 50 requested QIDs, resolving redirects and missing
   entities as the full request does. The answer is kept for the rest of the
   run, so the type checks of the catalog and the documents of its groups
   ask each QID once;
2. a QID whose resolved entity, revision and request profile already have a
   snapshot is served from that snapshot, read through its SHA-256;
3. only the rest is downloaded with the profile, in batches of 50.

The snapshot identity is the one the ADR 004 already fixes: QID, revision and
profile. A new revision has another identity, so it is always downloaded.
The served document holds the same payload a download of that revision
returns (the ADR 004 fails the run when a revision changes content), and the
pipeline saves it through ``save_entity_snapshot`` as before, so every fact
keeps pointing at the snapshot of the revision it came from.

Type checks of the catalog work the same way: a stored P31 for the QID and
revision is reused, and the claims are downloaded only for a new revision.

Every request still goes through the wrapped client, one at a time, with its
``maxlag``, timeout and ``User-Agent``. Importing the module starts nothing.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence

from . import rebuild_phases
from .fact_store import FactStore
from .storage import Repository
from .wikidata import (
    MAX_ENTITIES_PER_REQUEST,
    EntityBatch,
    EntityDocument,
    EntityProfile,
    TypeCheck,
    WikidataEntityClient,
)


def entity_batches(
    client: object,
    batches: Sequence[Sequence[str]],
    profile: EntityProfile,
) -> Iterator[EntityBatch]:
    """Yield one ``EntityBatch`` per batch, in order.

    A plain client gets one ``get_entities`` call per batch, made lazily, so
    the full rebuild keeps fetching and saving batch after batch. The
    incremental client checks the revisions of every batch first and
    downloads only what changed.
    """
    many = getattr(client, "get_entity_batches", None)
    if many is not None:
        yield from many(batches, profile)
        return
    for batch in batches:
        yield client.get_entities(batch, profile)


def _chunks(values: Sequence[str], size: int) -> Iterator[list[str]]:
    for start in range(0, len(values), size):
        yield list(values[start:start + size])


class IncrementalWikidataClient:
    """Answer like ``WikidataEntityClient`` but download only revisions not stored yet."""

    def __init__(self, client: WikidataEntityClient, repository: Repository) -> None:
        self.client = client
        self.repository = repository
        self.store = FactStore(repository)
        # Current revision of each QID asked in this run, whatever the profile:
        # the catalog type checks and the group documents ask the same QIDs.
        self._revisions: dict[str, EntityDocument | None] = {}

    def _current_revisions(self, wikidata_ids: Sequence[str]) -> dict[str, EntityDocument | None]:
        """Map each QID to its revision-only document, or ``None`` when it is missing."""
        unknown = [qid for qid in dict.fromkeys(wikidata_ids) if qid not in self._revisions]
        for chunk in _chunks(unknown, MAX_ENTITIES_PER_REQUEST):
            result = self.client.get_entity_revisions(chunk)
            self._revisions.update((document.requested_id, document) for document in result.documents)
            self._revisions.update((qid, None) for qid in result.missing)
        return {qid: self._revisions.get(qid) for qid in wikidata_ids}

    def get_type_checks(self, wikidata_ids: Iterable[str]) -> Iterator[TypeCheck]:
        ids = tuple(dict.fromkeys(wikidata_ids))
        revisions = self._current_revisions(ids)
        stale: list[str] = []
        reused = 0
        for wikidata_id in ids:
            revision = revisions.get(wikidata_id)
            if revision is None:
                # Missing for a full request too: it yields no check.
                continue
            if revision.redirected:
                # A full type check reads the entity under the requested QID;
                # let it decide what a redirected one gives.
                stale.append(wikidata_id)
                continue
            revision_id = revision.revision_id
            stored = self.repository.stored_type_check(wikidata_id, revision_id)
            if stored is None:
                stale.append(wikidata_id)
                continue
            reused += 1
            yield TypeCheck(wikidata_id, revision_id, stored)
        rebuild_phases.count_reuse("wikidata type checks", reused=reused, fetched=len(stale))
        if stale:
            yield from self.client.get_type_checks(stale)

    def get_entities(self, wikidata_ids: Iterable[str], profile: EntityProfile) -> EntityBatch:
        batch = list(wikidata_ids)
        if len(dict.fromkeys(batch)) > MAX_ENTITIES_PER_REQUEST:
            raise ValueError(f"get_entities accepts at most {MAX_ENTITIES_PER_REQUEST} IDs")
        return next(self.get_entity_batches([batch], profile))

    def get_entity_batches(
        self,
        batches: Sequence[Sequence[str]],
        profile: EntityProfile,
    ) -> Iterator[EntityBatch]:
        """Check the revisions of every batch, download what changed, then yield each batch."""
        requested = list(dict.fromkeys(qid for batch in batches for qid in batch))
        current = self._current_revisions(requested)
        missing = {qid for qid, revision in current.items() if revision is None}

        documents: dict[str, EntityDocument] = {}
        stale: list[str] = []
        for qid in requested:
            revision = current.get(qid)
            if revision is None:
                continue
            payload = self.store.stored_entity_payload(
                revision.wikidata_id, revision.revision_id, profile.name
            )
            if payload is None:
                stale.append(qid)
            else:
                documents[qid] = EntityDocument(
                    qid, revision.wikidata_id, revision.revision_id, payload
                )
        rebuild_phases.count_reuse(
            f"wikidata {profile.name}", reused=len(documents), fetched=len(stale)
        )
        for chunk in _chunks(stale, MAX_ENTITIES_PER_REQUEST):
            result = self.client.get_entities(chunk, profile)
            documents.update((document.requested_id, document) for document in result.documents)
            missing.update(result.missing)

        for batch in batches:
            ids = list(dict.fromkeys(batch))
            yield EntityBatch(
                tuple(documents[qid] for qid in ids if qid in documents),
                tuple(qid for qid in ids if qid not in documents and qid in missing),
            )
