"""Build a reviewed country-to-map-feature crosswalk without geometry I/O."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable, Mapping

SCHEMA_VERSION = "kpop-country-crosswalk-v2"
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_ISO_A2_PATTERN = re.compile(r"^[A-Z]{2}$")
_FEATURE_ID_PATTERN = re.compile(r"^[A-Z0-9]{3}$")


def build_country_crosswalk(
    feature_collection: Mapping[str, Any],
    reviewed_countries: Iterable[Mapping[str, str]],
    *,
    dataset_version: str,
    scale: str,
) -> dict[str, Any]:
    """Match reviewed country identities to Natural Earth features by Wikidata QID.

    ISO codes are retained as reviewed metadata and used only when a feature
    has no valid Wikidata QID. Names are intentionally excluded from the join.
    Missing or duplicated identifiers stay unresolved and are listed.
    """
    _require(isinstance(dataset_version, str) and dataset_version.strip(), "dataset_version required")
    _require(isinstance(scale, str) and scale.strip(), "scale required")
    _require(
        isinstance(feature_collection, Mapping)
        and feature_collection.get("type") == "FeatureCollection"
        and isinstance(feature_collection.get("features"), list),
        "input must be a GeoJSON FeatureCollection",
    )

    countries = _normalize_countries(reviewed_countries)
    features_by_qid: dict[str, list[str | None]] = {}
    features_by_iso_without_qid: dict[str, list[str | None]] = {}
    invalid_features = 0
    for feature in feature_collection["features"]:
        properties = (
            feature.get("properties")
            if isinstance(feature, Mapping) and feature.get("type") == "Feature"
            else None
        )
        if not isinstance(properties, Mapping):
            invalid_features += 1
            continue
        iso = properties.get("ISO_A2")
        qid = properties.get("WIKIDATAID")
        feature_id = properties.get("ADM0_A3")
        valid_qid = isinstance(qid, str) and bool(_QID_PATTERN.fullmatch(qid))
        valid_iso = isinstance(iso, str) and bool(_ISO_A2_PATTERN.fullmatch(iso))
        if not isinstance(feature_id, str) or not _FEATURE_ID_PATTERN.fullmatch(feature_id):
            invalid_features += 1
            if valid_qid:
                features_by_qid.setdefault(qid, []).append(None)
            elif valid_iso:
                features_by_iso_without_qid.setdefault(iso, []).append(None)
            continue
        if valid_qid:
            features_by_qid.setdefault(qid, []).append(feature_id)
        elif valid_iso:
            features_by_iso_without_qid.setdefault(iso, []).append(feature_id)
        else:
            invalid_features += 1

    matched: list[dict[str, str]] = []
    unresolved: list[dict[str, str]] = []
    for country in countries:
        matching_features = features_by_qid.get(country["wikidata_id"])
        if matching_features is None:
            matching_features = features_by_iso_without_qid.get(country["iso_3166_1"], [])
        if len(matching_features) == 1 and matching_features[0] is not None:
            matched.append(
                {
                    "wikidata_id": country["wikidata_id"],
                    "iso_3166_1": country["iso_3166_1"],
                    "map_feature_id": matching_features[0],
                }
            )
        else:
            unresolved.append(
                {
                    "wikidata_id": country["wikidata_id"],
                    "iso_3166_1": country["iso_3166_1"],
                    "reason": (
                        "feature_missing"
                        if not matching_features
                        else "feature_ambiguous"
                        if len(matching_features) > 1
                        else "feature_invalid_id"
                    ),
                }
            )

    body: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "dataset": {
            "name": "Natural Earth Admin 0 - Countries",
            "version": dataset_version,
            "scale": scale,
        },
        "feature_count": len(feature_collection["features"]),
        "matched_countries": sorted(matched, key=lambda row: row["wikidata_id"]),
        "unresolved_countries": sorted(unresolved, key=lambda row: row["wikidata_id"]),
        "invalid_feature_count": invalid_features,
    }
    body["crosswalk_id"] = _digest(body)
    validate_country_crosswalk(body)
    return body


def validate_country_crosswalk(payload: Mapping[str, Any]) -> None:
    """Validate crosswalk structure, unique joins, and its content hash."""
    required = {
        "schema_version",
        "dataset",
        "feature_count",
        "matched_countries",
        "unresolved_countries",
        "invalid_feature_count",
        "crosswalk_id",
    }
    _require(isinstance(payload, Mapping) and set(payload) == required, "invalid root fields")
    _require(payload["schema_version"] == SCHEMA_VERSION, "unsupported schema_version")
    dataset = payload["dataset"]
    _require(
        isinstance(dataset, Mapping)
        and set(dataset) == {"name", "version", "scale"}
        and dataset["name"] == "Natural Earth Admin 0 - Countries"
        and isinstance(dataset["version"], str)
        and bool(dataset["version"].strip())
        and isinstance(dataset["scale"], str)
        and bool(dataset["scale"].strip()),
        "invalid dataset metadata",
    )
    _require(
        type(payload["feature_count"]) is int and payload["feature_count"] >= 0,
        "feature_count must be a non-negative integer",
    )
    matched = payload["matched_countries"]
    unresolved = payload["unresolved_countries"]
    _require(isinstance(matched, list) and isinstance(unresolved, list), "country rows must be arrays")
    seen_qids: set[str] = set()
    seen_iso: set[str] = set()
    seen_feature_ids: set[str] = set()
    for row in matched:
        _require(isinstance(row, Mapping) and set(row) == {"wikidata_id", "iso_3166_1", "map_feature_id"}, "invalid matched country")
        _validate_country_pair(row["wikidata_id"], row["iso_3166_1"])
        feature_id = row["map_feature_id"]
        _require(isinstance(feature_id, str) and bool(_FEATURE_ID_PATTERN.fullmatch(feature_id)), "invalid map_feature_id")
        _require(row["wikidata_id"] not in seen_qids, "duplicate country QID")
        _require(row["iso_3166_1"] not in seen_iso, "duplicate country ISO code")
        _require(feature_id not in seen_feature_ids, "duplicate map feature ID")
        seen_qids.add(row["wikidata_id"])
        seen_iso.add(row["iso_3166_1"])
        seen_feature_ids.add(feature_id)
    for row in unresolved:
        _require(isinstance(row, Mapping) and set(row) == {"wikidata_id", "iso_3166_1", "reason"}, "invalid unresolved country")
        _validate_country_pair(row["wikidata_id"], row["iso_3166_1"])
        _require(row["wikidata_id"] not in seen_qids, "country appears more than once")
        _require(row["iso_3166_1"] not in seen_iso, "country ISO code appears more than once")
        _require(
            row["reason"] in {"feature_missing", "feature_ambiguous", "feature_invalid_id"},
            "invalid unresolved reason",
        )
        seen_qids.add(row["wikidata_id"])
        seen_iso.add(row["iso_3166_1"])
    _require(type(payload["invalid_feature_count"]) is int and payload["invalid_feature_count"] >= 0, "invalid_feature_count must be non-negative")
    _require(payload["invalid_feature_count"] <= payload["feature_count"], "invalid_feature_count exceeds feature_count")
    expected_id = _digest({key: value for key, value in payload.items() if key != "crosswalk_id"})
    _require(payload["crosswalk_id"] == expected_id, "crosswalk_id does not match content")


def _normalize_countries(countries: Iterable[Mapping[str, str]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    seen_qids: set[str] = set()
    seen_iso: set[str] = set()
    for index, country in enumerate(countries):
        _require(isinstance(country, Mapping), f"reviewed_countries[{index}] must be an object")
        _require(set(country) == {"wikidata_id", "iso_3166_1"}, f"reviewed_countries[{index}] has invalid fields")
        qid, iso = country["wikidata_id"], country["iso_3166_1"]
        _validate_country_pair(qid, iso)
        _require(qid not in seen_qids, f"duplicate reviewed country QID: {qid}")
        _require(iso not in seen_iso, f"duplicate reviewed country ISO code: {iso}")
        seen_qids.add(qid)
        seen_iso.add(iso)
        result.append({"wikidata_id": qid, "iso_3166_1": iso})
    return sorted(result, key=lambda row: row["wikidata_id"])


def _validate_country_pair(qid: Any, iso: Any) -> None:
    _require(isinstance(qid, str) and bool(_QID_PATTERN.fullmatch(qid)), "invalid Wikidata QID")
    _require(isinstance(iso, str) and bool(_ISO_A2_PATTERN.fullmatch(iso)), "ISO code must use two uppercase ASCII letters")


def _digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid country crosswalk: {message}")
