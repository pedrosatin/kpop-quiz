from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMAS_ROOT = REPO_ROOT / "schemas"
MAP_PATH = SCHEMAS_ROOT / "artifact-map.json"
WEB_DATA_ROOT = REPO_ROOT / "web" / "public" / "data"


def load_artifact_map() -> dict[str, Any]:
    return json.loads(MAP_PATH.read_text(encoding="utf-8"))


def resolve_artifact(relative_path: str, artifact_map: dict[str, Any] | None = None) -> dict[str, str]:
    mapping = artifact_map if artifact_map is not None else load_artifact_map()
    base = Path(relative_path).name
    prefix = mapping["map_pilot_prefix"]
    under_map_pilot = relative_path == prefix or relative_path.startswith(f"{prefix}/")

    if under_map_pilot:
        return {"kind": "unschemaed", "list_entry": "map-pilot/**"}

    by_basename = mapping["by_basename"]
    if base in by_basename:
        return {"kind": "schema", "schema_file": by_basename[base]}

    exact_without = {
        entry for entry in mapping["without_schema"] if "*" not in entry and "<" not in entry
    }
    if base in exact_without:
        return {"kind": "unschemaed", "list_entry": base}

    for pattern in mapping["patterns"]:
        if not re.fullmatch(pattern["regex"], base):
            continue
        if "schema" in pattern and pattern["schema"]:
            return {"kind": "schema", "schema_file": pattern["schema"]}
        return {"kind": "unschemaed", "list_entry": pattern["list_entry"]}

    return {"kind": "unknown"}


def list_json_files(data_root: Path) -> list[str]:
    paths: list[str] = []
    for path in sorted(data_root.rglob("*.json")):
        paths.append(path.relative_to(data_root).as_posix())
    return paths


def classify_directory(
    data_root: Path, artifact_map: dict[str, Any] | None = None
) -> tuple[list[tuple[str, str]], list[tuple[str, str]], list[str]]:
    mapping = artifact_map if artifact_map is not None else load_artifact_map()
    with_schema: list[tuple[str, str]] = []
    without_schema: list[tuple[str, str]] = []
    unknown: list[str] = []
    for relative_path in list_json_files(data_root):
        resolution = resolve_artifact(relative_path, mapping)
        kind = resolution["kind"]
        if kind == "schema":
            with_schema.append((relative_path, resolution["schema_file"]))
        elif kind == "unschemaed":
            without_schema.append((relative_path, resolution["list_entry"]))
        else:
            unknown.append(relative_path)
    return with_schema, without_schema, unknown
