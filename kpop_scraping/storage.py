"""SQLite persistence and immutable source snapshots."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .mediawiki import Page


class SnapshotIntegrityError(RuntimeError):
    """Raised when immutable snapshot content does not match its identity."""


Migration = tuple[int, str, Sequence[str]]


MIGRATIONS: tuple[Migration, ...] = (
    (
        1,
        "initial_collection_tables",
        (
            """
            CREATE TABLE IF NOT EXISTS collection_runs (
                id INTEGER PRIMARY KEY,
                category TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
                pages_collected INTEGER NOT NULL DEFAULT 0,
                error TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS source_pages (
                page_id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                extract TEXT NOT NULL,
                revision_id INTEGER,
                fetched_at TEXT NOT NULL,
                last_run_id INTEGER NOT NULL REFERENCES collection_runs(id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS source_pages_title_idx ON source_pages(title)",
        ),
    ),
    (
        2,
        "immutable_source_revisions",
        (
            "DROP INDEX IF EXISTS source_pages_title_idx",
            "ALTER TABLE source_pages RENAME TO source_pages_legacy",
            """
            CREATE TABLE source_pages (
                id INTEGER PRIMARY KEY,
                provider TEXT NOT NULL,
                language TEXT NOT NULL,
                external_page_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                extract TEXT NOT NULL,
                revision_id INTEGER,
                fetched_at TEXT NOT NULL,
                last_run_id INTEGER NOT NULL REFERENCES collection_runs(id),
                UNIQUE(provider, language, external_page_id)
            )
            """,
            """
            INSERT INTO source_pages(
                provider, language, external_page_id, title, canonical_url,
                extract, revision_id, fetched_at, last_run_id
            )
            SELECT 'wikipedia', 'en', page_id, title, canonical_url,
                   extract, revision_id, fetched_at, last_run_id
            FROM source_pages_legacy
            """,
            "DROP TABLE source_pages_legacy",
            "CREATE INDEX source_pages_title_idx ON source_pages(title)",
            """
            CREATE TABLE source_revisions (
                id INTEGER PRIMARY KEY,
                source_page_id INTEGER NOT NULL REFERENCES source_pages(id),
                external_revision_id INTEGER NOT NULL,
                snapshot_path TEXT NOT NULL,
                content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
                fetched_at TEXT NOT NULL,
                UNIQUE(source_page_id, external_revision_id),
                UNIQUE(snapshot_path)
            )
            """,
            """
            CREATE TABLE collection_run_revisions (
                collection_run_id INTEGER NOT NULL REFERENCES collection_runs(id),
                source_revision_id INTEGER NOT NULL REFERENCES source_revisions(id),
                PRIMARY KEY(collection_run_id, source_revision_id)
            )
            """,
        ),
    ),
    (
        3,
        "validated_group_catalog",
        (
            "ALTER TABLE source_pages ADD COLUMN wikidata_id TEXT",
            """
            ALTER TABLE source_pages ADD COLUMN is_redirect INTEGER NOT NULL DEFAULT 0
            CHECK(is_redirect IN (0, 1))
            """,
            """
            ALTER TABLE source_pages ADD COLUMN is_disambiguation INTEGER NOT NULL DEFAULT 0
            CHECK(is_disambiguation IN (0, 1))
            """,
            """
            CREATE TABLE collection_issues (
                id INTEGER PRIMARY KEY,
                collection_run_id INTEGER NOT NULL REFERENCES collection_runs(id),
                external_page_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                issue_code TEXT NOT NULL,
                detail TEXT,
                UNIQUE(collection_run_id, external_page_id, issue_code)
            )
            """,
            """
            CREATE TABLE wikidata_type_checks (
                id INTEGER PRIMARY KEY,
                wikidata_id TEXT NOT NULL,
                external_revision_id INTEGER NOT NULL,
                instance_of_json TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                UNIQUE(wikidata_id, external_revision_id)
            )
            """,
            """
            CREATE TABLE catalog_runs (
                id INTEGER PRIMARY KEY,
                classifier_version TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
                accepted INTEGER NOT NULL DEFAULT 0,
                rejected INTEGER NOT NULL DEFAULT 0,
                pending INTEGER NOT NULL DEFAULT 0,
                error TEXT
            )
            """,
            """
            CREATE TABLE catalog_entries (
                source_page_id INTEGER PRIMARY KEY REFERENCES source_pages(id),
                source_revision_id INTEGER NOT NULL REFERENCES source_revisions(id),
                analyzed_wikidata_id TEXT,
                state TEXT NOT NULL CHECK(state IN ('candidate', 'accepted', 'rejected')),
                rejection_reason TEXT,
                type_check_id INTEGER REFERENCES wikidata_type_checks(id),
                classifier_version TEXT NOT NULL,
                classified_at TEXT NOT NULL,
                CHECK(
                    (state = 'rejected' AND rejection_reason IS NOT NULL)
                    OR (state != 'rejected' AND rejection_reason IS NULL)
                )
            )
            """,
            "CREATE INDEX catalog_entries_state_idx ON catalog_entries(state)",
        ),
    ),
    (
        4,
        "wikidata_entities_and_facts",
        (
            """
            CREATE TABLE fact_runs (
                id INTEGER PRIMARY KEY,
                extractor_version TEXT NOT NULL,
                source_policy_version TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
                group_limit INTEGER CHECK(group_limit IS NULL OR group_limit > 0),
                groups_processed INTEGER NOT NULL DEFAULT 0,
                entities_saved INTEGER NOT NULL DEFAULT 0,
                wikidata_batches INTEGER NOT NULL DEFAULT 0,
                facts_accepted INTEGER NOT NULL DEFAULT 0,
                facts_rejected INTEGER NOT NULL DEFAULT 0,
                facts_conflict INTEGER NOT NULL DEFAULT 0,
                facts_superseded INTEGER NOT NULL DEFAULT 0,
                facts_stale INTEGER NOT NULL DEFAULT 0,
                statements_ignored INTEGER NOT NULL DEFAULT 0,
                error TEXT
            )
            """,
            """
            CREATE TABLE wikidata_entity_snapshots (
                id INTEGER PRIMARY KEY,
                wikidata_id TEXT NOT NULL,
                external_revision_id INTEGER NOT NULL CHECK(external_revision_id > 0),
                request_profile TEXT NOT NULL,
                snapshot_path TEXT NOT NULL,
                content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
                fetched_at TEXT NOT NULL,
                UNIQUE(wikidata_id, external_revision_id, request_profile),
                UNIQUE(snapshot_path)
            )
            """,
            """
            CREATE TABLE fact_run_snapshots (
                fact_run_id INTEGER NOT NULL REFERENCES fact_runs(id),
                snapshot_id INTEGER NOT NULL REFERENCES wikidata_entity_snapshots(id),
                PRIMARY KEY(fact_run_id, snapshot_id)
            )
            """,
            """
            CREATE TABLE fact_issues (
                id INTEGER PRIMARY KEY,
                fact_run_id INTEGER NOT NULL REFERENCES fact_runs(id),
                wikidata_id TEXT NOT NULL,
                issue_code TEXT NOT NULL,
                detail TEXT NOT NULL,
                UNIQUE(fact_run_id, wikidata_id, issue_code, detail)
            )
            """,
            """
            CREATE TABLE entities (
                id INTEGER PRIMARY KEY,
                wikidata_id TEXT NOT NULL UNIQUE,
                entity_type TEXT NOT NULL CHECK(
                    entity_type IN (
                        'group', 'person', 'organization', 'place',
                        'genre', 'language', 'instrument'
                    )
                ),
                canonical_name TEXT NOT NULL,
                snapshot_id INTEGER NOT NULL REFERENCES wikidata_entity_snapshots(id),
                source_page_id INTEGER REFERENCES source_pages(id),
                last_fact_run_id INTEGER REFERENCES fact_runs(id),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE entity_aliases (
                id INTEGER PRIMARY KEY,
                entity_id INTEGER NOT NULL REFERENCES entities(id),
                name TEXT NOT NULL,
                language TEXT NOT NULL,
                alias_type TEXT NOT NULL CHECK(
                    alias_type IN ('label', 'alias', 'native_name', 'romanization')
                ),
                source_property TEXT,
                snapshot_id INTEGER NOT NULL REFERENCES wikidata_entity_snapshots(id),
                UNIQUE(entity_id, language, alias_type, name)
            )
            """,
            """
            CREATE TABLE facts (
                id INTEGER PRIMARY KEY,
                subject_entity_id INTEGER NOT NULL REFERENCES entities(id),
                predicate TEXT NOT NULL,
                property_id TEXT NOT NULL,
                statement_id TEXT NOT NULL UNIQUE,
                rank TEXT NOT NULL CHECK(rank IN ('preferred', 'normal')),
                value_wikidata_id TEXT,
                value_entity_id INTEGER REFERENCES entities(id),
                value_time TEXT,
                value_precision INTEGER,
                value_calendar TEXT,
                value_raw_json TEXT NOT NULL,
                valid_from TEXT,
                valid_from_precision INTEGER,
                valid_to TEXT,
                valid_to_precision INTEGER,
                qualifiers_json TEXT NOT NULL,
                references_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK(
                    status IN ('accepted', 'rejected', 'conflict', 'superseded', 'stale')
                ),
                status_reason TEXT,
                quality_flags_json TEXT NOT NULL,
                snapshot_id INTEGER NOT NULL REFERENCES wikidata_entity_snapshots(id),
                fact_run_id INTEGER NOT NULL REFERENCES fact_runs(id),
                extractor_version TEXT NOT NULL,
                extracted_at TEXT NOT NULL,
                CHECK(value_wikidata_id IS NULL OR value_time IS NULL),
                CHECK(
                    status = 'rejected'
                    OR (value_wikidata_id IS NULL) != (value_time IS NULL)
                ),
                CHECK((value_time IS NULL) = (value_precision IS NULL)),
                CHECK(value_entity_id IS NULL OR value_wikidata_id IS NOT NULL),
                CHECK((valid_from IS NULL) = (valid_from_precision IS NULL)),
                CHECK((valid_to IS NULL) = (valid_to_precision IS NULL)),
                CHECK(
                    (status = 'accepted' AND status_reason IS NULL)
                    OR (status != 'accepted' AND status_reason IS NOT NULL)
                ),
                CHECK(
                    status != 'accepted'
                    OR value_wikidata_id IS NULL
                    OR value_entity_id IS NOT NULL
                )
            )
            """,
            "CREATE INDEX facts_subject_predicate_idx ON facts(subject_entity_id, predicate)",
            "CREATE INDEX facts_value_entity_idx ON facts(value_entity_id)",
            "CREATE INDEX facts_status_idx ON facts(status)",
            """
            CREATE TABLE fact_evidence (
                id INTEGER PRIMARY KEY,
                fact_id INTEGER NOT NULL REFERENCES facts(id),
                evidence_type TEXT NOT NULL CHECK(
                    evidence_type IN ('wikidata_reference', 'wikipedia_revision')
                ),
                wikidata_snapshot_id INTEGER REFERENCES wikidata_entity_snapshots(id),
                reference_hash TEXT,
                source_revision_id INTEGER REFERENCES source_revisions(id),
                source_key TEXT NOT NULL,
                locator TEXT NOT NULL,
                snippet TEXT,
                UNIQUE(fact_id, evidence_type, locator),
                CHECK(
                    (
                        evidence_type = 'wikidata_reference'
                        AND wikidata_snapshot_id IS NOT NULL
                        AND reference_hash IS NOT NULL
                        AND source_revision_id IS NULL
                    )
                    OR (
                        evidence_type = 'wikipedia_revision'
                        AND source_revision_id IS NOT NULL
                        AND wikidata_snapshot_id IS NULL
                        AND reference_hash IS NULL
                        AND snippet IS NOT NULL
                    )
                )
            )
            """,
        ),
    ),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(payload: Any) -> bytes:
    """Serialize JSON to the stable byte representation used for hashes."""
    return json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def spreadsheet_safe(value: Any) -> Any:
    """Prevent external text from being interpreted as a spreadsheet formula."""
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def apply_migrations(
    connection: sqlite3.Connection,
    migrations: Sequence[Migration] = MIGRATIONS,
) -> None:
    """Apply each pending migration in its own transaction."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )
    connection.commit()
    applied = {
        row[0]
        for row in connection.execute("SELECT version FROM schema_migrations")
    }
    for version, name, statements in migrations:
        if version in applied:
            continue
        try:
            connection.execute("BEGIN IMMEDIATE")
            for statement in statements:
                connection.execute(statement)
            connection.execute(
                "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
                (version, name, utc_now()),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise


class SnapshotStore:
    """Write and verify immutable gzip-compressed JSON snapshots."""

    _SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")
    _ENTITY_ID = re.compile(r"^Q[1-9][0-9]*$")

    def __init__(self, raw_dir: Path) -> None:
        self.raw_dir = raw_dir

    def relative_path(
        self,
        provider: str,
        language: str,
        page_id: int,
        revision_id: int,
    ) -> Path:
        if not self._SAFE_SEGMENT.fullmatch(provider):
            raise ValueError(f"invalid snapshot provider: {provider!r}")
        if not self._SAFE_SEGMENT.fullmatch(language):
            raise ValueError(f"invalid snapshot language: {language!r}")
        if page_id < 1 or revision_id < 1:
            raise ValueError("snapshot page and revision IDs must be positive")
        return Path(provider) / language / str(page_id) / f"{revision_id}.json.gz"

    def entity_relative_path(
        self,
        provider: str,
        profile: str,
        entity_id: str,
        revision_id: int,
    ) -> Path:
        if not self._SAFE_SEGMENT.fullmatch(provider):
            raise ValueError(f"invalid snapshot provider: {provider!r}")
        if not self._SAFE_SEGMENT.fullmatch(profile):
            raise ValueError(f"invalid snapshot profile: {profile!r}")
        if not self._ENTITY_ID.fullmatch(entity_id):
            raise ValueError(f"invalid snapshot entity ID: {entity_id!r}")
        if revision_id < 1:
            raise ValueError("snapshot revision IDs must be positive")
        return Path(provider) / profile / entity_id / f"{revision_id}.json.gz"

    def write(
        self,
        provider: str,
        language: str,
        page_id: int,
        revision_id: int,
        content: bytes,
    ) -> tuple[str, str]:
        relative_path = self.relative_path(provider, language, page_id, revision_id)
        return self._write(relative_path, content)

    def write_entity(
        self,
        provider: str,
        profile: str,
        entity_id: str,
        revision_id: int,
        content: bytes,
    ) -> tuple[str, str]:
        relative_path = self.entity_relative_path(
            provider, profile, entity_id, revision_id
        )
        return self._write(relative_path, content)

    def _write(self, relative_path: Path, content: bytes) -> tuple[str, str]:
        target = self.raw_dir / relative_path
        digest = hashlib.sha256(content).hexdigest()

        if target.exists():
            self.verify(relative_path.as_posix(), digest)
            return relative_path.as_posix(), digest

        target.parent.mkdir(parents=True, exist_ok=True)
        compressed = gzip.compress(content, mtime=0)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=target.parent,
                prefix=f".{target.name}.",
                delete=False,
            ) as temporary:
                temporary.write(compressed)
                temporary.flush()
                os.fsync(temporary.fileno())
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, target)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        return relative_path.as_posix(), digest

    def read(self, relative_path: str, expected_digest: str) -> bytes:
        """Return decompressed snapshot bytes after checking their hash."""
        path = self.raw_dir / relative_path
        try:
            content = gzip.decompress(path.read_bytes())
        except (OSError, EOFError) as exc:
            raise SnapshotIntegrityError(f"cannot read snapshot {relative_path}") from exc
        actual_digest = hashlib.sha256(content).hexdigest()
        if actual_digest != expected_digest:
            raise SnapshotIntegrityError(
                f"snapshot hash mismatch for {relative_path}: "
                f"expected {expected_digest}, got {actual_digest}"
            )
        return content

    def verify(self, relative_path: str, expected_digest: str) -> None:
        self.read(relative_path, expected_digest)


class Repository:
    def __init__(self, database_path: Path, raw_dir: Path | None = None) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(database_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.snapshots = SnapshotStore(raw_dir or database_path.parent / "raw")
        self._apply_migrations()

    def __enter__(self) -> "Repository":
        return self

    def __exit__(self, *_args: object) -> None:
        self.connection.close()

    def _apply_migrations(self) -> None:
        apply_migrations(self.connection)

    def start_run(self, category: str) -> int:
        cursor = self.connection.execute(
            "INSERT INTO collection_runs(category, started_at, status) VALUES (?, ?, 'running')",
            (category, utc_now()),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def save_pages(
        self,
        run_id: int,
        pages: Iterable[Page],
        provider: str = "wikipedia",
        language: str = "en",
    ) -> int:
        fetched_at = utc_now()
        saved = 0
        for page in pages:
            if page.is_missing:
                self.connection.execute(
                    """
                    INSERT INTO collection_issues(
                        collection_run_id, external_page_id, title, issue_code, detail
                    ) VALUES (?, ?, ?, 'missing_page', ?)
                    ON CONFLICT(collection_run_id, external_page_id, issue_code) DO NOTHING
                    """,
                    (run_id, page.page_id, page.title, "No source revision was available"),
                )
                continue
            if page.revision_id is None:
                raise ValueError(f"page {page.page_id} has no revision ID")
            payload = page.source_payload or {
                "pageid": page.page_id,
                "title": page.title,
                "canonicalurl": page.canonical_url,
                "extract": page.extract,
                "revisions": [{"revid": page.revision_id}],
            }
            content = canonical_json(payload)
            digest = hashlib.sha256(content).hexdigest()

            previous_page = self.connection.execute(
                """
                SELECT title, wikidata_id, is_redirect, is_disambiguation
                FROM source_pages
                WHERE provider=? AND language=? AND external_page_id=?
                """,
                (provider, language, page.page_id),
            ).fetchone()
            classification_input_changed = previous_page is not None and (
                previous_page["title"] != page.title
                or previous_page["wikidata_id"] != page.wikidata_id
                or bool(previous_page["is_redirect"]) != page.is_redirect
                or bool(previous_page["is_disambiguation"]) != page.is_disambiguation
            )

            existing = self.connection.execute(
                """
                SELECT sr.id, sr.snapshot_path, sr.content_sha256
                FROM source_revisions sr
                JOIN source_pages sp ON sp.id = sr.source_page_id
                WHERE sp.provider=? AND sp.language=? AND sp.external_page_id=?
                  AND sr.external_revision_id=?
                """,
                (provider, language, page.page_id, page.revision_id),
            ).fetchone()
            if existing is not None:
                if existing["content_sha256"] != digest:
                    raise SnapshotIntegrityError(
                        f"revision {page.revision_id} of page {page.page_id} changed content"
                    )
                self.snapshots.verify(existing["snapshot_path"], digest)

            self.connection.execute(
                """
                INSERT INTO source_pages(
                    provider, language, external_page_id, title, canonical_url,
                    extract, revision_id, fetched_at, last_run_id, wikidata_id,
                    is_redirect, is_disambiguation
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, language, external_page_id) DO UPDATE SET
                    title=excluded.title, canonical_url=excluded.canonical_url,
                    extract=excluded.extract, revision_id=excluded.revision_id,
                    fetched_at=excluded.fetched_at, last_run_id=excluded.last_run_id,
                    wikidata_id=excluded.wikidata_id,
                    is_redirect=excluded.is_redirect,
                    is_disambiguation=excluded.is_disambiguation
                """,
                (
                    provider,
                    language,
                    page.page_id,
                    page.title,
                    page.canonical_url,
                    page.extract,
                    page.revision_id,
                    fetched_at,
                    run_id,
                    page.wikidata_id,
                    int(page.is_redirect),
                    int(page.is_disambiguation),
                ),
            )
            source_page_id = self.connection.execute(
                """
                SELECT id FROM source_pages
                WHERE provider=? AND language=? AND external_page_id=?
                """,
                (provider, language, page.page_id),
            ).fetchone()["id"]

            if existing is None:
                snapshot_path, digest = self.snapshots.write(
                    provider,
                    language,
                    page.page_id,
                    page.revision_id,
                    content,
                )
                cursor = self.connection.execute(
                    """
                    INSERT INTO source_revisions(
                        source_page_id, external_revision_id, snapshot_path,
                        content_sha256, fetched_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (source_page_id, page.revision_id, snapshot_path, digest, fetched_at),
                )
                source_revision_id = int(cursor.lastrowid)
            else:
                source_revision_id = int(existing["id"])

            self.connection.execute(
                """
                INSERT INTO collection_run_revisions(collection_run_id, source_revision_id)
                VALUES (?, ?)
                ON CONFLICT(collection_run_id, source_revision_id) DO NOTHING
                """,
                (run_id, source_revision_id),
            )
            self.connection.execute(
                """
                INSERT INTO catalog_entries(
                    source_page_id, source_revision_id, analyzed_wikidata_id,
                    state, rejection_reason, type_check_id, classifier_version,
                    classified_at
                ) VALUES (?, ?, ?, 'candidate', NULL, NULL, 'pending', ?)
                ON CONFLICT(source_page_id) DO UPDATE SET
                    source_revision_id=excluded.source_revision_id,
                    analyzed_wikidata_id=excluded.analyzed_wikidata_id,
                    state='candidate', rejection_reason=NULL, type_check_id=NULL,
                    classifier_version='pending', classified_at=excluded.classified_at
                WHERE catalog_entries.source_revision_id != excluded.source_revision_id
                   OR catalog_entries.analyzed_wikidata_id IS NOT excluded.analyzed_wikidata_id
                   OR ?
                """,
                (
                    source_page_id,
                    source_revision_id,
                    page.wikidata_id,
                    fetched_at,
                    int(classification_input_changed),
                ),
            )
            saved += 1
        return saved

    def catalog_entries_for_classification(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            """
            SELECT ce.source_page_id, ce.source_revision_id, sp.title,
                   ce.analyzed_wikidata_id AS wikidata_id,
                   sp.is_redirect, sp.is_disambiguation
            FROM catalog_entries ce
            JOIN source_pages sp ON sp.id = ce.source_page_id
            ORDER BY sp.provider, sp.language, sp.external_page_id
            """
        ).fetchall()

    def start_catalog_run(self, classifier_version: str) -> int:
        cursor = self.connection.execute(
            """
            INSERT INTO catalog_runs(classifier_version, started_at, status)
            VALUES (?, ?, 'running')
            """,
            (classifier_version, utc_now()),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def complete_catalog_run(
        self,
        run_id: int,
        accepted: int,
        rejected: int,
        pending: int,
    ) -> None:
        self.connection.execute(
            """
            UPDATE catalog_runs
            SET completed_at=?, status='completed', accepted=?, rejected=?, pending=?
            WHERE id=?
            """,
            (utc_now(), accepted, rejected, pending, run_id),
        )
        self.connection.commit()

    def fail_catalog_run(self, run_id: int, error: str) -> None:
        self.connection.rollback()
        self.connection.execute(
            """
            UPDATE catalog_runs
            SET completed_at=?, status='failed', error=?
            WHERE id=?
            """,
            (utc_now(), error[:1000], run_id),
        )
        self.connection.commit()

    def save_type_check(
        self,
        wikidata_id: str,
        revision_id: int,
        instance_of: Sequence[str],
    ) -> int:
        instance_of_json = json.dumps(
            sorted(set(instance_of)), separators=(",", ":")
        )
        existing = self.connection.execute(
            """
            SELECT id, instance_of_json FROM wikidata_type_checks
            WHERE wikidata_id=? AND external_revision_id=?
            """,
            (wikidata_id, revision_id),
        ).fetchone()
        if existing is not None:
            if existing["instance_of_json"] != instance_of_json:
                raise SnapshotIntegrityError(
                    f"Wikidata revision {revision_id} of {wikidata_id} changed P31"
                )
            return int(existing["id"])
        self.connection.execute(
            """
            INSERT INTO wikidata_type_checks(
                wikidata_id, external_revision_id, instance_of_json, fetched_at
            ) VALUES (?, ?, ?, ?)
            """,
            (wikidata_id, revision_id, instance_of_json, utc_now()),
        )
        row = self.connection.execute(
            """
            SELECT id FROM wikidata_type_checks
            WHERE wikidata_id=? AND external_revision_id=?
            """,
            (wikidata_id, revision_id),
        ).fetchone()
        return int(row["id"])

    def set_catalog_decision(
        self,
        source_page_id: int,
        source_revision_id: int,
        state: str,
        classifier_version: str,
        rejection_reason: str | None = None,
        type_check_id: int | None = None,
    ) -> None:
        if state not in {"accepted", "rejected"}:
            raise ValueError(f"invalid final catalog state: {state}")
        if (state == "rejected") != (rejection_reason is not None):
            raise ValueError("only rejected entries require a rejection reason")
        cursor = self.connection.execute(
            """
            UPDATE catalog_entries
            SET state=?, rejection_reason=?, type_check_id=?,
                classifier_version=?, classified_at=?
            WHERE source_page_id=? AND source_revision_id=?
            """,
            (
                state,
                rejection_reason,
                type_check_id,
                classifier_version,
                utc_now(),
                source_page_id,
                source_revision_id,
            ),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("catalog candidate changed during classification")

    def export_catalog_csv(self, output_path: Path) -> int:
        rows = self.connection.execute(
            """
            SELECT sp.provider, sp.language, sp.external_page_id AS pageid,
                   sp.title, sp.canonical_url, sp.wikidata_id, sp.revision_id,
                   ce.state, ce.rejection_reason, ce.classifier_version,
                   wt.external_revision_id AS wikidata_revision_id,
                   wt.instance_of_json
            FROM catalog_entries ce
            JOIN source_pages sp ON sp.id = ce.source_page_id
            LEFT JOIN wikidata_type_checks wt ON wt.id = ce.type_check_id
            ORDER BY sp.provider, sp.language, sp.external_page_id
            """
        ).fetchall()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fieldnames = (
            "provider",
            "language",
            "pageid",
            "title",
            "canonical_url",
            "wikidata_id",
            "revision_id",
            "state",
            "rejection_reason",
            "classifier_version",
            "wikidata_revision_id",
            "instance_of_json",
        )
        with output_path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(
                {
                    key: spreadsheet_safe(value)
                    for key, value in dict(row).items()
                }
                for row in rows
            )
        return len(rows)

    def complete_run(self, run_id: int, pages_collected: int) -> None:
        self.connection.execute(
            "UPDATE collection_runs SET completed_at=?, status='completed', pages_collected=? WHERE id=?",
            (utc_now(), pages_collected, run_id),
        )
        self.connection.commit()

    def fail_run(self, run_id: int, error: str) -> None:
        self.connection.rollback()
        self.connection.execute(
            "UPDATE collection_runs SET completed_at=?, status='failed', error=? WHERE id=?",
            (utc_now(), error[:1000], run_id),
        )
        self.connection.commit()
