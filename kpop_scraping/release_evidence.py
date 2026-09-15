"""Collect fixed Wikipedia revisions linked from release Wikidata snapshots."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .evidence import WikipediaPage
from .mediawiki import MAX_EXTRACTS_PER_REQUEST, MediaWikiClient, Page
from .storage import utc_now


SITES = (("enwiki", "en"), ("ptwiki", "pt"), ("kowiki", "ko"))
_LIST_TITLE = re.compile(r"^(?:list of|lista de|목록)", re.IGNORECASE)


@dataclass(frozen=True)
class _PageRequest:
    entity_id: int
    snapshot_id: int
    qid: str
    language: str
    title: str
    sequence: int


def collect_release_pages(
    repository,
    releases: Sequence[tuple[int, int, str, object, Mapping]],
    clients: Mapping[str, MediaWikiClient],
) -> dict[str, tuple[WikipediaPage, ...]]:
    """Fetch one resolved sitelink per language and retain eligible revisions."""
    pages: dict[str, list[WikipediaPage]] = {}
    cursor = repository.connection.execute(
        "INSERT INTO collection_runs(category,started_at,status) VALUES (?,?, 'running')",
        ("release-wikipedia-evidence", utc_now()),
    )
    collection_run_id = int(cursor.lastrowid)
    requests: dict[str, list[_PageRequest]] = defaultdict(list)
    ordered_requests: list[_PageRequest] = []
    for entity_id, snapshot_id, qid, _extracted, payload in releases:
        sitelinks = payload.get("sitelinks") if isinstance(payload, Mapping) else None
        sitelinks = sitelinks if isinstance(sitelinks, Mapping) else {}
        for site, language in SITES:
            link = sitelinks.get(site)
            title = link.get("title") if isinstance(link, Mapping) else None
            if not isinstance(title, str) or not title.strip():
                _record(repository, entity_id, language, snapshot_id, "missing", "sitelink_missing")
                continue
            client = clients.get(language)
            if client is None:
                _record(repository, entity_id, language, snapshot_id, "missing", "client_missing")
                continue
            request = _PageRequest(
                entity_id, snapshot_id, qid, language, title.strip(),
                len(ordered_requests),
            )
            requests[language].append(request)
            ordered_requests.append(request)

    matched_pages: dict[int, Page | None] = {}
    for _site, language in SITES:
        client = clients.get(language)
        language_requests = requests.get(language, ())
        if client is None or not language_requests:
            continue
        for offset in range(0, len(language_requests), MAX_EXTRACTS_PER_REQUEST):
            batch = language_requests[offset : offset + MAX_EXTRACTS_PER_REQUEST]
            found = client.get_pages_by_titles(tuple(item.title for item in batch))
            matched_pages.update(
                (item.sequence, page)
                for item, page in zip(batch, _match_pages(batch, found))
            )

    saved = 0
    for item in ordered_requests:
        page = matched_pages[item.sequence]
        reason = _page_rejection(page, item.qid)
        if reason:
            _record(
                repository, item.entity_id, item.language, item.snapshot_id,
                "rejected", reason,
            )
            continue
        assert page is not None and page.revision_id is not None
        repository.save_pages(
            collection_run_id,
            (page,),
            provider="wikipedia",
            language=item.language,
            create_catalog_entries=False,
        )
        saved += _store_page_result(repository, pages, item, page)
    repository.connection.execute(
        "UPDATE collection_runs SET completed_at=?,status='completed',pages_collected=? WHERE id=?",
        (utc_now(), saved, collection_run_id),
    )
    return {qid: tuple(items) for qid, items in pages.items()}


def _match_pages(
    requests: Sequence[_PageRequest], found: Sequence[Page]
) -> tuple[Page | None, ...]:
    """Associate unordered MediaWiki results with every requested release."""
    by_title: dict[str, list[Page]] = defaultdict(list)
    by_qid: dict[str, list[Page]] = defaultdict(list)
    for page in found:
        by_title[_title_key(page.title)].append(page)
        if page.wikidata_id:
            by_qid[page.wikidata_id].append(page)
    for matches in (*by_title.values(), *by_qid.values()):
        matches.sort(key=lambda page: (page.page_id, page.title, page.revision_id or -1))

    matched = []
    for item in requests:
        exact = by_title.get(_title_key(item.title), ())
        exact_qid = [page for page in exact if page.wikidata_id == item.qid]
        qid_matches = by_qid.get(item.qid, ())
        matched.append(
            exact_qid[0] if exact_qid else
            qid_matches[0] if qid_matches else
            exact[0] if exact else None
        )
    return tuple(matched)


def _title_key(title: str) -> str:
    return " ".join(title.replace("_", " ").split()).casefold()


def _store_page_result(repository, pages, item: _PageRequest, page: Page) -> int:
    row = repository.connection.execute(
        """SELECT sp.id AS page_id,sr.id AS revision_id,
                  sr.snapshot_path,sr.content_sha256
        FROM source_pages sp JOIN source_revisions sr ON sr.source_page_id=sp.id
        WHERE sp.provider='wikipedia' AND sp.language=?
          AND sp.external_page_id=? AND sr.external_revision_id=?""",
        (item.language, page.page_id, page.revision_id),
    ).fetchone()
    _record(
        repository, item.entity_id, item.language, item.snapshot_id, "accepted", None,
        int(row["page_id"]), int(row["revision_id"]),
    )
    stored_payload = json.loads(
        repository.snapshots.read(row["snapshot_path"], row["content_sha256"])
    )
    stored_extract = stored_payload.get("extract")
    if not isinstance(stored_extract, str):
        raise RuntimeError("release Wikipedia snapshot has no text extract")
    pages.setdefault(item.qid, []).append(
        WikipediaPage(
            int(row["revision_id"]), item.language, page.page_id,
            page.revision_id, stored_extract.strip(), page.title,
        )
    )
    return 1


def _page_rejection(page: Page | None, qid: str) -> str | None:
    if page is None or page.is_missing or page.revision_id is None:
        return "page_missing"
    if page.is_disambiguation:
        return "page_disambiguation"
    if _LIST_TITLE.match(page.title.strip()):
        return "page_list"
    if page.wikidata_id != qid:
        return "page_wikidata_mismatch"
    if not page.extract.strip():
        return "page_extract_empty"
    lead = page.extract.split(".", 1)[0]
    if not re.search(
        r"\b(?:album|single|EP|extended play|record|song|álbum|sencillo)\b|(?:음반|싱글)",
        lead,
        re.IGNORECASE,
    ):
        return "page_subject_type_mismatch"
    return None


def _record(
    repository,
    entity_id: int,
    language: str,
    snapshot_id: int,
    state: str,
    reason: str | None,
    source_page_id: int | None = None,
    source_revision_id: int | None = None,
) -> None:
    repository.connection.execute(
        """INSERT INTO release_source_pages(
            release_entity_id,language,source_page_id,source_revision_id,
            wikidata_snapshot_id,state,reason,checked_at
        ) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(release_entity_id,language) DO UPDATE SET
            source_page_id=excluded.source_page_id,
            source_revision_id=excluded.source_revision_id,
            wikidata_snapshot_id=excluded.wikidata_snapshot_id,
            state=excluded.state,reason=excluded.reason,checked_at=excluded.checked_at""",
        (
            entity_id, language, source_page_id, source_revision_id,
            snapshot_id, state, reason, utc_now(),
        ),
    )
