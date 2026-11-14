"""Discover release candidates through WDQS without treating it as evidence."""

from __future__ import annotations

import hashlib
import json
import re
import ssl
import time
from dataclasses import dataclass
from http.client import HTTPException
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from .http_request import DEFAULT_USER_AGENT, open_url
from .mediawiki import MediaWikiError, parse_retry_after
from .storage import Repository, utc_now


DISCOVERER_VERSION = "release-discovery-v1"
DEFAULT_ENDPOINT = "https://query.wikidata.org/sparql"
MAX_GROUPS_PER_QUERY = 25
MAX_CANDIDATES_PER_GROUP = 100
MAX_RESPONSE_BYTES = 5_000_000
RETRYABLE_HTTP_STATUS = frozenset({429, 500, 502, 503, 504})
ALLOWED_DIRECT_TYPES = ("Q482994", "Q169930", "Q134556")
# A canonical item QID: ASCII digits without leading zeros. str.isdigit()
# also accepts digits such as "²" and "١", and Q7, Q07 and Q007 would be
# three candidates for one item. _qid_order and the cut boundary that
# _mark_stale_releases compares in SQL both rely on this form.
_CANONICAL_QID = re.compile(r"Q[1-9][0-9]*")


@dataclass(frozen=True)
class DiscoveredRelease:
    group_id: str
    release_id: str


@dataclass(frozen=True)
class TruncatedGroup:
    """A group whose WDQS answer had more candidates than the per-group limit."""

    group_id: str
    candidates: int
    kept: int
    last_kept: str

    @property
    def discarded(self) -> int:
        return self.candidates - self.kept


@dataclass(frozen=True)
class DiscoveryResult:
    run_id: int
    truncated: tuple[TruncatedGroup, ...]


@dataclass(frozen=True)
class QueryResult:
    body: bytes
    http_status: int


class WikidataQueryClient:
    def __init__(
        self,
        endpoint: str = DEFAULT_ENDPOINT,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout: float = 30,
        retries: int = 2,
        max_response_bytes: int = MAX_RESPONSE_BYTES,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        if not user_agent.strip():
            raise ValueError("user_agent must not be empty")
        self.endpoint = endpoint
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        if max_response_bytes < 1:
            raise ValueError("max_response_bytes must be positive")
        self.max_response_bytes = max_response_bytes
        self.opener = opener

    def query(self, sparql: str) -> QueryResult:
        url = f"{self.endpoint}?{urlencode({'query': sparql, 'format': 'json'})}"
        for attempt in range(self.retries + 1):
            try:
                with open_url(
                    url,
                    timeout=self.timeout,
                    user_agent=self.user_agent,
                    headers={"Accept": "application/sparql-results+json"},
                    opener=self.opener,
                ) as response:
                    body = response.read(self.max_response_bytes + 1)
                    status = int(getattr(response, "status", 200))
                if len(body) > self.max_response_bytes:
                    raise MediaWikiError("WDQS response exceeds the configured size limit")
                payload = json.loads(body)
                if not isinstance(payload, dict) or not isinstance(payload.get("results", {}).get("bindings"), list):
                    raise MediaWikiError("WDQS response has an unexpected shape")
                return QueryResult(body, status)
            except HTTPError as exc:
                headers = exc.headers
                status = exc.code
                exc.close()
                if status not in RETRYABLE_HTTP_STATUS or attempt >= self.retries:
                    raise MediaWikiError(
                        f"WDQS request failed with HTTP {status}",
                        transient=status in RETRYABLE_HTTP_STATUS,
                    ) from exc
                delay = parse_retry_after(headers.get("Retry-After")) or float(2**attempt)
                if delay > 120:
                    raise MediaWikiError("WDQS Retry-After exceeds 120 seconds", transient=True) from exc
                time.sleep(delay)
            # getresponse() and read() raise ConnectionError, HTTPException
            # (RemoteDisconnected, IncompleteRead) and ssl.SSLError without the
            # URLError wrapper that urlopen puts on connection failures.
            except (
                URLError,
                TimeoutError,
                ConnectionError,
                HTTPException,
                ssl.SSLError,
                json.JSONDecodeError,
            ) as exc:
                if attempt >= self.retries:
                    raise MediaWikiError("WDQS request failed", transient=True) from exc
                time.sleep(float(2**attempt))
        raise AssertionError("retry loop exited unexpectedly")


def build_query(group_ids: list[str]) -> str:
    if not 1 <= len(group_ids) <= MAX_GROUPS_PER_QUERY:
        raise ValueError(f"group_ids must contain 1 to {MAX_GROUPS_PER_QUERY} QIDs")
    qids = sorted(set(group_ids))
    if len(qids) != len(group_ids) or not all(_CANONICAL_QID.fullmatch(qid) for qid in qids):
        raise ValueError("group_ids must be unique Wikidata QIDs")
    groups = " ".join(f"wd:{qid}" for qid in qids)
    types = " ".join(f"wd:{qid}" for qid in ALLOWED_DIRECT_TYPES)
    return (
        "SELECT DISTINCT ?release ?performer WHERE {\n"
        f"  VALUES ?performer {{ {groups} }}\n"
        "  ?release wdt:P175 ?performer; wdt:P31 ?directType.\n"
        f"  VALUES ?directType {{ {types} }}\n"
        "}\nORDER BY ?performer ?release"
    )


def discover_releases(
    repository: Repository,
    client: WikidataQueryClient,
    group_limit: int = MAX_GROUPS_PER_QUERY,
    group_offset: int = 0,
    max_per_group: int = MAX_CANDIDATES_PER_GROUP,
) -> DiscoveryResult:
    """Store the WDQS candidates of one batch of accepted groups.

    A group with more than ``max_per_group`` candidates keeps the ones with the
    lowest QIDs; ``DiscoveryResult.truncated`` and the
    ``candidates_discarded`` and ``last_kept_wikidata_id`` columns of
    ``release_discovery_groups`` record the cut.
    """
    if not 1 <= group_limit <= MAX_GROUPS_PER_QUERY:
        raise ValueError("group_limit is outside the supported WDQS batch")
    if not 1 <= max_per_group <= MAX_CANDIDATES_PER_GROUP:
        raise ValueError("max_per_group is outside the supported candidate limit")
    if group_offset < 0:
        raise ValueError("group_offset must not be negative")
    groups = repository.connection.execute(
        """
        SELECT DISTINCT e.id, e.wikidata_id FROM entities e
        JOIN catalog_entity_links cel ON cel.entity_id=e.id
        JOIN catalog_entries ce ON ce.source_page_id=cel.source_page_id
        WHERE e.entity_type='group' AND ce.state='accepted'
        ORDER BY e.wikidata_id LIMIT ? OFFSET ?
        """,
        (group_limit, group_offset),
    ).fetchall()
    if not groups:
        raise ValueError("no accepted catalog groups are available")
    by_qid = {row["wikidata_id"]: int(row["id"]) for row in groups}
    query = build_query(list(by_qid))
    query_hash = hashlib.sha256(query.encode()).hexdigest()
    cursor = repository.connection.execute(
        """INSERT INTO release_discovery_runs(
            discoverer_version,query,query_sha256,endpoint,started_at,status
        ) VALUES (?,?,?,?,?,'running')""",
        (DISCOVERER_VERSION, query, query_hash, client.endpoint, utc_now()),
    )
    run_id = int(cursor.lastrowid)
    repository.connection.executemany(
        "INSERT INTO release_discovery_groups(run_id,group_entity_id) VALUES (?,?)",
        [(run_id, entity_id) for entity_id in sorted(by_qid.values())],
    )
    repository.connection.commit()
    try:
        result = client.query(query)
        body = result.body
        path, digest = repository.snapshots.write_discovery(run_id, body)
        repository.connection.execute(
            "INSERT INTO release_discovery_snapshots(run_id,snapshot_path,content_sha256,http_status,fetched_at) VALUES (?,?,?,?,?)",
            (run_id, path, digest, result.http_status, utc_now()),
        )
        releases, truncated = _parse_results(body, set(by_qid), max_per_group)
        repository.connection.executemany(
            "INSERT INTO release_candidates(run_id,group_entity_id,requested_wikidata_id,state) VALUES (?,?,?,'candidate')",
            [(run_id, by_qid[item.group_id], item.release_id) for item in releases],
        )
        repository.connection.executemany(
            """UPDATE release_discovery_groups SET candidates_discarded=?,last_kept_wikidata_id=?
            WHERE run_id=? AND group_entity_id=?""",
            [(group.discarded, group.last_kept, run_id, by_qid[group.group_id]) for group in truncated],
        )
        repository.connection.execute(
            "UPDATE release_discovery_runs SET completed_at=?,status='completed',candidates_found=? WHERE id=?",
            (utc_now(), len(releases), run_id),
        )
        repository.connection.commit()
    except Exception as exc:
        repository.connection.rollback()
        repository.connection.execute(
            "UPDATE release_discovery_runs SET completed_at=?,status='failed',error=? WHERE id=?",
            (utc_now(), str(exc)[:1000], run_id),
        )
        repository.connection.commit()
        raise
    return DiscoveryResult(run_id, truncated)


def _qid_order(qid: str) -> tuple[int, str]:
    """Sort canonical QIDs by number: Q123 comes before Q1000, which text order reverses.

    Without leading zeros, a shorter QID is a smaller number, and QIDs of
    equal length compare as text in numeric order. This avoids int(), which
    refuses strings above 4300 digits.
    """
    return len(qid), qid


def _parse_results(
    body: bytes, groups: set[str], max_per_group: int
) -> tuple[tuple[DiscoveredRelease, ...], tuple[TruncatedGroup, ...]]:
    """Read the WDQS answer and cut each group down to ``max_per_group`` candidates.

    Anyone can add a P175 statement that names a group, so a group may come
    back with more candidates than the limit. Aborting would fail every run
    while that edit stands. The group keeps the candidates with the lowest
    QIDs instead: the cut depends only on the answer's content, never on its
    order or on set and hash order, and items created after the others, such
    as a flood of new ones, carry higher QIDs and are the ones left out.
    """
    payload = json.loads(body)
    by_group: dict[str, set[str]] = {group: set() for group in groups}
    for binding in payload["results"]["bindings"]:
        try:
            group = binding["performer"]["value"].rsplit("/", 1)[1]
            release = binding["release"]["value"].rsplit("/", 1)[1]
        except (KeyError, TypeError, IndexError) as exc:
            raise MediaWikiError("WDQS binding has an unexpected shape") from exc
        if group not in groups or not _CANONICAL_QID.fullmatch(release):
            raise MediaWikiError("WDQS binding contains an unexpected entity")
        by_group[group].add(release)
    releases: list[DiscoveredRelease] = []
    truncated: list[TruncatedGroup] = []
    for group in sorted(groups):
        ordered = sorted(by_group[group], key=_qid_order)
        kept = ordered[:max_per_group]
        if len(ordered) > len(kept):
            truncated.append(TruncatedGroup(group, len(ordered), len(kept), kept[-1]))
        releases.extend(DiscoveredRelease(group, release) for release in kept)
    return tuple(releases), tuple(truncated)
