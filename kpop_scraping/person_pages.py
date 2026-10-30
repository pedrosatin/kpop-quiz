"""Collect the English Wikipedia page of each person whose birth facts need it.

The page is evidence only when it is the person's own page: it must resolve
without a redirect, declare the person's Wikidata item and carry wikitext.
Every request ends in a row of ``person_source_pages`` that says which revision
was kept or why the page was refused, so a reviewer can trace a rejected fact
back to its collection.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .evidence import WikipediaPage
from .fact_store import FactStore
from .mediawiki import MAX_EXTRACTS_PER_REQUEST, MAX_REVISIONS_PER_REQUEST, MediaWikiClient, Page
from .storage import utc_now

LANGUAGE = "en"
CATEGORY = "person-wikipedia-evidence"


@dataclass(frozen=True)
class PersonPageRequest:
    qid: str
    entity_id: int
    snapshot_id: int
    title: str


@dataclass(frozen=True)
class _Kept:
    request: PersonPageRequest
    page: Page
    source_page_id: int
    source_revision_id: int


def collect_person_pages(
    store: FactStore,
    client: MediaWikiClient,
    requests: Sequence[PersonPageRequest],
) -> dict[str, WikipediaPage]:
    """Fetch the fixed revision and wikitext of each person page and keep the valid ones.

    Requests and revisions go out in sequence, in the batch sizes the API
    allows. The result maps a person's QID to the page that may serve as
    evidence. Revisions already stored are not downloaded again.
    """
    ordered = sorted(requests, key=lambda request: request.qid)
    if not ordered:
        return {}
    run_id = int(
        store.connection.execute(
            "INSERT INTO collection_runs(category, started_at, status) VALUES (?, ?, 'running')",
            (CATEGORY, utc_now()),
        ).lastrowid
    )
    valid: list[tuple[PersonPageRequest, Page]] = []
    for start in range(0, len(ordered), MAX_EXTRACTS_PER_REQUEST):
        batch = ordered[start : start + MAX_EXTRACTS_PER_REQUEST]
        resolved = client.resolve_titles([request.title for request in batch])
        for request in batch:
            page = resolved.get(request.title.strip())
            reason = _page_rejection(page, request.qid)
            if reason:
                _record(store, run_id, request, "rejected", reason, page)
            else:
                assert page is not None
                valid.append((request, page))

    kept = [_keep(store, run_id, request, page) for request, page in valid]
    wikitexts = _wikitexts(store, client, kept)
    pages: dict[str, WikipediaPage] = {}
    for item in kept:
        text = wikitexts.get(item.source_revision_id)
        if not text:
            _record(store, run_id, item.request, "rejected", "wikitext_unavailable", item.page)
            continue
        _record(store, run_id, item.request, "accepted", None, item.page, item)
        # The extract stays empty: only the infobox in the wikitext may prove a fact.
        pages[item.request.qid] = WikipediaPage(
            item.source_revision_id,
            LANGUAGE,
            item.page.page_id,
            int(item.page.revision_id or 0),
            "",
            item.page.title,
            text,
            item.page.wikidata_id or "",
            item.page.is_redirect,
        )
    store.connection.execute(
        "UPDATE collection_runs SET completed_at=?, status='completed', pages_collected=? WHERE id=?",
        (utc_now(), len(pages), run_id),
    )
    return pages


def _page_rejection(page: Page | None, qid: str) -> str | None:
    if page is None or page.is_missing or page.revision_id is None:
        return "page_missing"
    if page.is_redirect:
        return "page_redirect"
    if page.is_disambiguation:
        return "page_disambiguation"
    if page.wikidata_id != qid:
        return "page_wikidata_mismatch"
    return None


def _keep(store: FactStore, run_id: int, request: PersonPageRequest, page: Page) -> _Kept:
    """Store the revision as an immutable snapshot, without a catalog entry."""
    store.repository.save_pages(
        run_id, (page,), provider="wikipedia", language=LANGUAGE, create_catalog_entries=False
    )
    row = store.connection.execute(
        """
        SELECT sp.id AS page_id, sr.id AS revision_id
        FROM source_pages sp JOIN source_revisions sr ON sr.source_page_id = sp.id
        WHERE sp.provider = 'wikipedia' AND sp.language = ?
          AND sp.external_page_id = ? AND sr.external_revision_id = ?
        """,
        (LANGUAGE, page.page_id, page.revision_id),
    ).fetchone()
    return _Kept(request, page, int(row["page_id"]), int(row["revision_id"]))


def _wikitexts(store: FactStore, client: MediaWikiClient, kept: Sequence[_Kept]) -> dict[int, str]:
    """Read the stored wikitext of each kept revision, downloading what is missing."""
    texts: dict[int, str] = {}
    missing: list[_Kept] = []
    for item in kept:
        stored = store.revision_wikitext(item.source_revision_id)
        if stored is None:
            missing.append(item)
        else:
            texts[item.source_revision_id] = stored
    for start in range(0, len(missing), MAX_REVISIONS_PER_REQUEST):
        batch = missing[start : start + MAX_REVISIONS_PER_REQUEST]
        sources = client.get_revision_wikitext([int(item.page.revision_id) for item in batch])
        for item in batch:
            source = sources.get(int(item.page.revision_id))
            if source is None or source["pageid"] != item.page.page_id:
                continue
            store.save_revision_wikitext(item.source_revision_id, LANGUAGE, source)
            texts[item.source_revision_id] = source["wikitext"]
    return texts


def _record(
    store: FactStore,
    run_id: int,
    request: PersonPageRequest,
    state: str,
    reason: str | None,
    page: Page | None,
    kept: _Kept | None = None,
) -> None:
    store.connection.execute(
        """
        INSERT INTO person_source_pages(
            person_entity_id, language, requested_title, source_page_id,
            source_revision_id, page_wikidata_id, wikidata_snapshot_id,
            collection_run_id, state, reason, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_entity_id, language) DO UPDATE SET
            requested_title=excluded.requested_title,
            source_page_id=excluded.source_page_id,
            source_revision_id=excluded.source_revision_id,
            page_wikidata_id=excluded.page_wikidata_id,
            wikidata_snapshot_id=excluded.wikidata_snapshot_id,
            collection_run_id=excluded.collection_run_id,
            state=excluded.state, reason=excluded.reason,
            checked_at=excluded.checked_at
        """,
        (
            request.entity_id,
            LANGUAGE,
            request.title,
            kept.source_page_id if kept else None,
            kept.source_revision_id if kept else None,
            page.wikidata_id if page else None,
            request.snapshot_id,
            run_id,
            state,
            reason,
            utc_now(),
        ),
    )
