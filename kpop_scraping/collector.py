"""Collection orchestration independent from CLI and persistence details."""

from collections.abc import Iterable, Iterator, Sequence
from itertools import islice

from . import rebuild_phases
from .mediawiki import MAX_EXTRACTS_PER_REQUEST, MAX_REVISIONS_PER_REQUEST, MediaWikiClient, Page
from .storage import Repository


def batched(values: Iterable[int], size: int) -> Iterator[list[int]]:
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def collect_category(
    client: MediaWikiClient,
    repository: Repository,
    category: str,
    limit: int | None = None,
    incremental: bool = False,
) -> int:
    """Store the current revision of every page in ``category``.

    Pages are saved in the order the category lists them, 20 at a time. With
    ``incremental``, the current revision of every page is asked first, 50
    pages per request, and a page whose revision already has a stored
    snapshot is built from that snapshot with the metadata just fetched.
    Only pages with a revision not stored yet are downloaded with their
    extract. Both ways write the same rows; the incremental one does not see
    an extract that changed without a new revision (ADR 036), because it
    does not download it.
    """
    run_id = repository.start_run(category)
    provider = getattr(client, "provider", "wikipedia")
    language = getattr(client, "language", "en")
    collected = 0
    try:
        members = islice(client.iter_category_members(category), limit)
        page_ids = [member["pageid"] for member in members]
        if incremental:
            pages = _incremental_pages(client, repository, page_ids, provider, language)
        else:
            pages = _downloaded_pages(client, page_ids)
        for page_id_batch, batch_pages in pages:
            collected += repository.save_pages(
                run_id,
                _in_request_order(page_id_batch, batch_pages),
                provider=provider,
                language=language,
            )
        repository.complete_run(run_id, collected)
        return collected
    except Exception as exc:
        repository.fail_run(run_id, str(exc))
        raise


def _downloaded_pages(
    client: MediaWikiClient, page_ids: Sequence[int]
) -> Iterator[tuple[list[int], list[Page]]]:
    for page_id_batch in batched(page_ids, MAX_EXTRACTS_PER_REQUEST):
        yield page_id_batch, client.get_pages(page_id_batch)


def _incremental_pages(
    client: MediaWikiClient,
    repository: Repository,
    page_ids: Sequence[int],
    provider: str,
    language: str,
) -> Iterator[tuple[list[int], list[Page]]]:
    current: dict[int, Page] = {}
    for page_id_batch in batched(page_ids, MAX_REVISIONS_PER_REQUEST):
        current.update((page.page_id, page) for page in client.get_page_revisions(page_id_batch))

    pages: dict[int, Page] = {}
    stale: list[int] = []
    for page_id in dict.fromkeys(page_ids):
        page = current.get(page_id)
        stored = None
        if page is not None and not page.is_missing and page.revision_id is not None:
            stored = repository.stored_page_payload(provider, language, page_id, page.revision_id)
        if stored is None:
            stale.append(page_id)
            continue
        pages[page_id] = Page(
            page_id=page.page_id,
            title=page.title,
            canonical_url=page.canonical_url,
            extract=stored["extract"].strip(),
            revision_id=page.revision_id,
            source_payload=stored,
            wikidata_id=page.wikidata_id,
            is_redirect=page.is_redirect,
            is_disambiguation=page.is_disambiguation,
        )
    rebuild_phases.count_reuse(
        f"{provider} {language} pages", reused=len(pages), fetched=len(stale)
    )
    requested = set(stale)
    # A page the answer holds but no request named, saved last as the full
    # collection would save it after the pages of its batch.
    extra: list[Page] = []
    for page_id_batch in batched(stale, MAX_EXTRACTS_PER_REQUEST):
        for page in client.get_pages(page_id_batch):
            if page.page_id in requested and page.page_id not in pages:
                pages[page.page_id] = page
            else:
                extra.append(page)

    for page_id_batch in batched(page_ids, MAX_EXTRACTS_PER_REQUEST):
        yield page_id_batch, [
            pages[page_id] for page_id in dict.fromkeys(page_id_batch) if page_id in pages
        ]
    if extra:
        yield [], extra


def _in_request_order(page_ids: Sequence[int], pages: Iterable[Page]) -> list[Page]:
    """Order pages as requested; a page the request did not name goes last.

    The API may answer in another order. Saving in the category's order
    makes the rows the full and the incremental collection write identical.
    """
    position = {page_id: index for index, page_id in enumerate(page_ids)}
    return sorted(pages, key=lambda page: position.get(page.page_id, len(position)))
