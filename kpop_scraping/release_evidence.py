"""Collect fixed Wikipedia revisions linked from release Wikidata snapshots."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence

from .evidence import WikipediaPage
from .mediawiki import MediaWikiClient, Page
from .storage import utc_now


SITES = (("enwiki", "en"), ("ptwiki", "pt"), ("kowiki", "ko"))
_LIST_TITLE = re.compile(r"^(?:list of|lista de|목록)", re.IGNORECASE)


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
    saved = 0
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
            found = client.get_pages_by_titles((title,))
            page = found[0] if found else None
            reason = _page_rejection(page, qid)
            if reason:
                _record(repository, entity_id, language, snapshot_id, "rejected", reason)
                continue
            assert page is not None and page.revision_id is not None
            repository.save_pages(
                collection_run_id,
                (page,),
                provider="wikipedia",
                language=language,
                create_catalog_entries=False,
            )
            row = repository.connection.execute(
                """SELECT sp.id AS page_id,sr.id AS revision_id,
                          sr.snapshot_path,sr.content_sha256
                FROM source_pages sp JOIN source_revisions sr ON sr.source_page_id=sp.id
                WHERE sp.provider='wikipedia' AND sp.language=?
                  AND sp.external_page_id=? AND sr.external_revision_id=?""",
                (language, page.page_id, page.revision_id),
            ).fetchone()
            _record(
                repository, entity_id, language, snapshot_id, "accepted", None,
                int(row["page_id"]), int(row["revision_id"]),
            )
            stored_payload = json.loads(
                repository.snapshots.read(
                    row["snapshot_path"], row["content_sha256"]
                )
            )
            stored_extract = stored_payload.get("extract")
            if not isinstance(stored_extract, str):
                raise RuntimeError("release Wikipedia snapshot has no text extract")
            pages.setdefault(qid, []).append(
                WikipediaPage(
                    int(row["revision_id"]), language, page.page_id,
                    page.revision_id, stored_extract.strip(), page.title,
                )
            )
            saved += 1
    repository.connection.execute(
        "UPDATE collection_runs SET completed_at=?,status='completed',pages_collected=? WHERE id=?",
        (utc_now(), saved, collection_run_id),
    )
    return {qid: tuple(items) for qid, items in pages.items()}


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
