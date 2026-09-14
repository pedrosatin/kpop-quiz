"""Collection orchestration independent from CLI and persistence details."""

from collections.abc import Iterable, Iterator
from itertools import islice

from .mediawiki import MAX_EXTRACTS_PER_REQUEST, MediaWikiClient
from .storage import Repository


def batched(values: Iterable[int], size: int) -> Iterator[list[int]]:
    iterator = iter(values)
    while batch := list(islice(iterator, size)):
        yield batch


def collect_category(client: MediaWikiClient, repository: Repository, category: str, limit: int | None = None) -> int:
    run_id = repository.start_run(category)
    collected = 0
    try:
        members = islice(client.iter_category_members(category), limit)
        page_ids = (member["pageid"] for member in members)
        for page_id_batch in batched(page_ids, MAX_EXTRACTS_PER_REQUEST):
            collected += repository.save_pages(
                run_id,
                client.get_pages(page_id_batch),
                provider=getattr(client, "provider", "wikipedia"),
                language=getattr(client, "language", "en"),
            )
        repository.complete_run(run_id, collected)
        return collected
    except Exception as exc:
        repository.fail_run(run_id, str(exc))
        raise
