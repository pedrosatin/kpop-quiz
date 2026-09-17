"""Licensed media registry and validation for quiz assets."""

from __future__ import annotations

import re
from datetime import date
from typing import Any
from urllib.parse import urlsplit

PERMITTED_LICENSES = frozenset(
    {
        "CC0",
        "CC0 1.0",
        "CC BY 2.0",
        "CC BY 2.5",
        "CC BY 3.0",
        "CC BY 4.0",
        "CC BY-SA 2.0",
        "CC BY-SA 2.5",
        "CC BY-SA 3.0",
        "CC BY-SA 4.0",
        "Public Domain",
        "OFL 1.1",
    }
)

LICENSED_MEDIA_FIELDS = frozenset(
    {
        "asset_url",
        "source_url",
        "creator",
        "license_name",
        "license_url",
        "subject_qid",
        "verified_at",
        "transformations",
    }
)

_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_licensed_media(media: dict[str, Any]) -> None:
    """Validate that media dictionary conforms to licensed-media-v1 schema and policy.

    Raises ValueError when the media record is invalid or uses an unpermitted license.
    """
    if not isinstance(media, dict):
        raise ValueError(f"media must be a dictionary, got {type(media).__name__}")

    media_fields = set(media.keys())
    missing = LICENSED_MEDIA_FIELDS - media_fields
    if missing:
        raise ValueError(f"media missing required fields: {sorted(missing)}")
    extra = media_fields - LICENSED_MEDIA_FIELDS
    if extra:
        raise ValueError(f"media contains unexpected fields: {sorted(extra)}")

    # asset_url: URI with http/https
    asset_url = media.get("asset_url")
    if not isinstance(asset_url, str) or not asset_url:
        raise ValueError("media asset_url must be a non-empty string")
    parsed_asset = urlsplit(asset_url)
    if parsed_asset.scheme not in {"http", "https"} or not parsed_asset.netloc:
        raise ValueError(f"media asset_url must have http or https scheme: {asset_url}")

    # source_url: URI with https
    source_url = media.get("source_url")
    if not isinstance(source_url, str) or not source_url:
        raise ValueError("media source_url must be a non-empty string")
    parsed_source = urlsplit(source_url)
    if parsed_source.scheme != "https" or not parsed_source.netloc:
        raise ValueError(f"media source_url must have https scheme: {source_url}")

    # creator: non-empty string
    creator = media.get("creator")
    if not isinstance(creator, str) or not creator.strip():
        raise ValueError("media creator must be a non-empty string")

    # license_name: non-empty string, must be in PERMITTED_LICENSES
    license_name = media.get("license_name")
    if not isinstance(license_name, str) or not license_name.strip():
        raise ValueError("media license_name must be a non-empty string")
    if license_name not in PERMITTED_LICENSES:
        raise ValueError(
            f"unpermitted license '{license_name}': only licenses permitting redistribution "
            f"and commercial/editorial use are allowed ({', '.join(sorted(PERMITTED_LICENSES))})"
        )

    # license_url: URI with http/https
    license_url = media.get("license_url")
    if not isinstance(license_url, str) or not license_url:
        raise ValueError("media license_url must be a non-empty string")
    parsed_license = urlsplit(license_url)
    if parsed_license.scheme not in {"http", "https"} or not parsed_license.netloc:
        raise ValueError(f"media license_url must have http or https scheme: {license_url}")

    # subject_qid: Wikidata QID matching ^Q[1-9][0-9]*$
    subject_qid = media.get("subject_qid")
    if not isinstance(subject_qid, str) or not _QID_PATTERN.match(subject_qid):
        raise ValueError(f"media subject_qid must match '^Q[1-9][0-9]*$', got '{subject_qid}'")

    # verified_at: ISO date format YYYY-MM-DD
    verified_at = media.get("verified_at")
    if not isinstance(verified_at, str) or not _DATE_PATTERN.match(verified_at):
        raise ValueError(f"media verified_at must be an ISO date YYYY-MM-DD, got '{verified_at}'")
    try:
        date.fromisoformat(verified_at)
    except ValueError as exc:
        raise ValueError(f"media verified_at is not a valid calendar date: '{verified_at}'") from exc

    # transformations: non-empty list of non-empty strings
    transformations = media.get("transformations")
    if not isinstance(transformations, list) or len(transformations) < 1:
        raise ValueError("media transformations must be a non-empty list")
    for item in transformations:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("media transformations must contain only non-empty strings")
