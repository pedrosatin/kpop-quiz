"""Schema identity and offline publication reserve for the daily rebuild."""
from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

from .storage import MIGRATIONS


def schema_version() -> str:
    """Hash every migration, including edits to an existing migration's DDL."""
    return hashlib.sha256(json.dumps(MIGRATIONS, ensure_ascii=True).encode()).hexdigest()


def marker_path(database: Path) -> Path:
    return database.with_name(database.name + ".schema")


def compatible(database: Path) -> bool:
    marker = marker_path(database)
    return (
        database.is_file()
        and marker.is_file()
        and marker.read_text().strip() == schema_version()
    )


def install_reserve(target: Path) -> None:
    """Install the publication-only database shipped with the source, without network."""
    reserve = Path(__file__).resolve().parents[1] / "data" / "publication-reserve.sqlite.gz"
    target.write_bytes(gzip.decompress(reserve.read_bytes()))


# Only public inputs read by the generators: no run logs or local snapshot paths.
PUBLIC_COLUMNS = {
    "entities": "id,wikidata_id,entity_type,canonical_name",
    "entity_aliases": "entity_id,language,name,alias_type",
    "facts": "id,statement_id,subject_entity_id,predicate,property_id,rank,value_wikidata_id,value_entity_id,value_time,value_precision,valid_from,valid_from_precision,valid_to,valid_to_precision,qualifiers_json,references_json,status,status_reason,quality_flags_json,extractor_version",
    "fact_evidence": "fact_id,evidence_type,source_key,locator,reference_hash,snippet,wikidata_snapshot_id,source_revision_id",
    "wikidata_entity_snapshots": "id,wikidata_id,external_revision_id",
    "source_revisions": "id,source_page_id,external_revision_id",
    "source_pages": "id,provider,language,external_page_id,wikidata_id,title",
    "catalog_entries": "source_page_id,type_check_id,state,analyzed_wikidata_id",
    "wikidata_type_checks": "id,wikidata_id,external_revision_id,instance_of_json",
}


def export_reserve(source: Path, target: Path) -> None:
    """Export a reviewed collection as a compact, publication-only SQLite reserve."""
    with sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True) as original, sqlite3.connect(":memory:") as output:
        for table, columns in PUBLIC_COLUMNS.items():
            rows = original.execute(f"SELECT {columns} FROM {table} ORDER BY rowid")
            names = columns.split(",")
            output.execute(f"CREATE TABLE {table} ({columns})")
            output.executemany(f"INSERT INTO {table} VALUES ({','.join('?' for _ in names)})", rows)
        output.commit()
        target.write_bytes(gzip.compress(output.serialize(), mtime=0))


if __name__ == "__main__":
    print(schema_version())
