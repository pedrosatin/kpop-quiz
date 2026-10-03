"""Curated licensed-media pool pipeline for quiz questions.

A pool file ships only when three independent inputs agree: the
Commons license check (this module reads `extmetadata` but never trusts it
blindly), a recorded human verdict (depicts the subject, solo portrait,
resolution floor), and `media_registry.validate_licensed_media` as the final
gate. Network lives only in the small fetch/download helpers; everything
else is pure and unit-tested.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

from .media_registry import PERMITTED_LICENSES, validate_licensed_media

POOL_SCHEMA_VERSION = "photo-pool-v1"
POOL_MIN_PER_IDOL = 2
POOL_PORTRAIT_SHORT_SIDE_PX = 400
USER_AGENT = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-quiz)"

LICENSE_DEED_URLS = {
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
    "CC BY 2.5": "https://creativecommons.org/licenses/by/2.5/",
    "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
    "CC BY-SA 2.5": "https://creativecommons.org/licenses/by-sa/2.5/",
    "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "Public Domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "OFL 1.1": "https://scripts.sil.org/OFL",
}

_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def license_deed_url(license_name: str) -> str:
    """Return the deed URL for a permitted license name.

    Raises KeyError for names outside the deed table (including names the
    registry itself would reject).
    """
    return LICENSE_DEED_URLS[license_name]


def strip_html_markup(value: str) -> str:
    """Drop HTML tags from Commons Artist strings, keeping readable text."""
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def validate_photo_verdict(verdict: dict[str, Any]) -> None:
    """Validate one human verdict record.

    Required keys: file_title (non-empty), subject_qid (QID),
    depicts_subject (bool, True only when the reviewer saw the idol),
    solo_portrait (bool), min_short_side_px (int >= 1),
    reviewer (non-empty), verified_at (YYYY-MM-DD).
    """
    if not isinstance(verdict, dict):
        raise ValueError(f"verdict must be a dictionary, got {type(verdict).__name__}")
    for key in (
        "file_title",
        "subject_qid",
        "depicts_subject",
        "solo_portrait",
        "min_short_side_px",
        "reviewer",
        "verified_at",
    ):
        if key not in verdict:
            raise ValueError(f"verdict missing required field: {key}")
    if not isinstance(verdict["file_title"], str) or not verdict["file_title"].strip():
        raise ValueError("verdict file_title must be a non-empty string")
    if not isinstance(verdict["subject_qid"], str) or not _QID_PATTERN.match(
        verdict["subject_qid"]
    ):
        raise ValueError(
            f"verdict subject_qid must match '^Q[1-9][0-9]*$', got {verdict['subject_qid']!r}"
        )
    for key in ("depicts_subject", "solo_portrait"):
        if not isinstance(verdict[key], bool):
            raise ValueError(f"verdict {key} must be a boolean")
    if (
        not isinstance(verdict["min_short_side_px"], int)
        or verdict["min_short_side_px"] < 1
    ):
        raise ValueError("verdict min_short_side_px must be a positive integer")
    if not isinstance(verdict["reviewer"], str) or not verdict["reviewer"].strip():
        raise ValueError("verdict reviewer must be a non-empty string")
    verified_at = verdict["verified_at"]
    if not isinstance(verified_at, str) or not _DATE_PATTERN.match(verified_at):
        raise ValueError(f"verdict verified_at must be YYYY-MM-DD, got {verified_at!r}")
    date.fromisoformat(verified_at)


def build_photo_record(
    *,
    file_title: str,
    file_page_url: str,
    license_name: str,
    creator: str,
    subject_qid: str,
    verified_at: str,
    asset_path: str,
    transformations: list[str],
) -> dict[str, Any]:
    """Build one licensed-media-v1 record for a verified pool file.

    Raises ValueError when the license is not permitted or any field is
    invalid (via validate_licensed_media). Callers pass the human-verified
    values; this function never decides depiction itself.
    """
    if license_name not in PERMITTED_LICENSES:
        raise ValueError(
            f"unpermitted license '{license_name}' for {file_title}: "
            "only registry-permitted licenses ship"
        )
    record = {
        "asset_url": asset_path,
        "source_url": file_page_url,
        "creator": strip_html_markup(creator) or "unknown",
        "license_name": license_name,
        "license_url": license_deed_url(license_name),
        "subject_qid": subject_qid,
        "verified_at": verified_at,
        "transformations": list(transformations),
    }
    validate_licensed_media(record)
    return record


def write_pool_registry(records: list[dict[str, Any]], path: Path) -> None:
    """Validate every record and write the versioned registry JSON."""
    for record in records:
        validate_licensed_media(record)
    payload = {"schema_version": POOL_SCHEMA_VERSION, "records": records}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_pool_registry(path: Path) -> list[dict[str, Any]]:
    """Read and validate a registry file written by write_pool_registry."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != POOL_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported pool schema: {payload.get('schema_version')!r}"
        )
    records = payload.get("records")
    if not isinstance(records, list):
        raise ValueError("pool registry records must be a list")
    for record in records:
        validate_licensed_media(record)
    return records


def select_verified_pool(
    verdicts: list[dict[str, Any]],
    min_per_idol: int = POOL_MIN_PER_IDOL,
) -> dict[str, list[dict[str, Any]]]:
    """Group positive verdicts by subject QID, keeping idols at the minimum.

    A verdict counts only when depicts_subject and solo_portrait are both
    true. Returns QID -> verdicts for idols with at least min_per_idol files.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for verdict in verdicts:
        validate_photo_verdict(verdict)
        if (
            verdict["depicts_subject"]
            and verdict["solo_portrait"]
            and meets_resolution_floor(verdict)
        ):
            grouped.setdefault(verdict["subject_qid"], []).append(verdict)
    return {
        qid: items for qid, items in grouped.items() if len(items) >= min_per_idol
    }


def check_revalidation(
    stored: dict[str, Any], fresh: dict[str, Any] | None
) -> dict[str, Any]:
    """Compare a registry record against fresh imageinfo.

    fresh is None when the file page is gone (deleted/renamed). Returns
    {"ok": bool, "reasons": [str]}. License drift, mediatype drift, and
    disappearance all fail closed.
    """
    reasons: list[str] = []
    if fresh is None:
        return {"ok": False, "reasons": ["file page missing from Commons"]}
    if fresh.get("license_name") != stored.get("license_name"):
        reasons.append(
            f"license changed: {stored.get('license_name')!r} -> {fresh.get('license_name')!r}"
        )
    if (fresh.get("license_name") or "") not in PERMITTED_LICENSES:
        reasons.append(f"current license not permitted: {fresh.get('license_name')!r}")
    if fresh.get("mediatype") != "BITMAP":
        reasons.append(f"mediatype is not BITMAP: {fresh.get('mediatype')!r}")
    return {"ok": not reasons, "reasons": reasons}


def download_asset(
    url: str,
    destination: Path,
    user_agent: str = USER_AGENT,
    timeout: float = 60,
) -> Path:
    """Download one file sequentially with an identifiable User-Agent."""
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=timeout) as response, open(
        destination, "wb"
    ) as handle:
        handle.write(response.read())
    return destination


def candidate_asset_name(file_title: str, subject_qid: str, index: int) -> str:
    """Derive a filesystem-safe asset name scoped by subject QID."""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", file_title.replace("File:", "", 1)).strip("._")
    return f"{subject_qid}-{index:02d}-{stem[:80]}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Curated licensed-media pool: registry, download, revalidation"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="candidates + verdicts JSON -> registry JSON")
    build.add_argument("--candidates", type=Path, required=True)
    build.add_argument("--verdicts", type=Path, required=True)
    build.add_argument("--registry", type=Path, required=True)
    build.add_argument("--site-base", default="https://kpopquiz.online")
    download = sub.add_parser("download", help="registry + candidates -> asset files")
    download.add_argument("--registry", type=Path, required=True)
    download.add_argument("--candidates", type=Path, required=True)
    download.add_argument("--assets-dir", type=Path, required=True)
    revalidate = sub.add_parser("revalidate", help="registry JSON -> report JSON")
    revalidate.add_argument("--registry", type=Path, required=True)
    revalidate.add_argument("--report", type=Path, required=True)
    revalidate.add_argument("--api-url", default="https://commons.wikimedia.org/w/api.php")
    return parser


def load_candidates(path: Path) -> dict[str, dict[str, Any]]:
    """Index candidate file entries by file_title.

    Each entry needs file_url (direct upload URL), file_page_url (Commons
    File: page), license_name, creator, subject_qid, width, height.
    """
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"candidates file must hold a JSON list: {path}")
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("file_title"):
            raise ValueError(f"candidates entries need file_title: {path}")
    return {entry["file_title"]: entry for entry in entries}


def meets_resolution_floor(verdict: dict[str, Any]) -> bool:
    """Whether a verdict clears the portrait resolution floor."""
    return verdict.get("min_short_side_px", 0) >= POOL_PORTRAIT_SHORT_SIDE_PX


def file_page_title(source_url: str) -> str:
    """Derive the Commons File: title from a stored file-page URL."""
    name = Path(source_url).name.replace("_", " ")
    if name.startswith("File:"):
        return name
    return f"File:{name}"


def revalidate_record(client: Any, record: dict[str, Any]) -> dict[str, Any]:
    """Revalidate one registry record against fresh Commons imageinfo."""
    from .mediawiki import MediaWikiError

    try:
        payload = client._get(
            {
                "action": "query",
                "titles": file_page_title(record["source_url"]),
                "prop": "imageinfo",
                "iiprop": "extmetadata|mediatype",
            }
        )
    except MediaWikiError as exc:
        return {"ok": False, "reasons": [f"revalidation request failed: {exc}"]}
    fresh = None
    for page in ((payload.get("query") or {}).get("pages") or []):
        infos = page.get("imageinfo") or []
        if infos and "missing" not in page:
            meta = infos[0].get("extmetadata") or {}
            fresh = {
                "license_name": (meta.get("LicenseShortName") or {}).get("value", ""),
                "mediatype": infos[0].get("mediatype"),
            }
    check = check_revalidation(record, fresh)
    return {"source_url": record["source_url"], **check}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return _run(args)
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def _run(args: argparse.Namespace) -> int:
    if args.command == "build":
        candidates = load_candidates(args.candidates)
        verdicts = json.loads(args.verdicts.read_text(encoding="utf-8"))
        if not isinstance(verdicts, list):
            raise ValueError(f"verdicts file must hold a JSON list: {args.verdicts}")
        for verdict in verdicts:
            validate_photo_verdict(verdict)
        positive = []
        skipped_floor = 0
        for verdict in verdicts:
            if not (
                verdict["depicts_subject"]
                and verdict["solo_portrait"]
                and verdict["file_title"] in candidates
            ):
                continue
            if not meets_resolution_floor(verdict):
                skipped_floor += 1
                continue
            entry = candidates[verdict["file_title"]]
            if entry.get("subject_qid") != verdict["subject_qid"]:
                raise SystemExit(
                    "verdict/candidate subject mismatch for "
                    f"{verdict['file_title']}: {entry.get('subject_qid')} != "
                    f"{verdict['subject_qid']}"
                )
            positive.append(verdict)
        per_subject: dict[str, int] = {}
        records = []
        for verdict in positive:
            entry = candidates[verdict["file_title"]]
            per_subject[verdict["subject_qid"]] = per_subject.get(verdict["subject_qid"], 0) + 1
            asset_name = candidate_asset_name(
                verdict["file_title"],
                verdict["subject_qid"],
                per_subject[verdict["subject_qid"]],
            )
            records.append(
                build_photo_record(
                    file_title=verdict["file_title"],
                    file_page_url=entry["file_page_url"],
                    license_name=entry["license_name"],
                    creator=entry.get("creator", ""),
                    subject_qid=verdict["subject_qid"],
                    verified_at=verdict["verified_at"],
                    asset_path=f"{args.site_base.rstrip('/')}/media/photo/{asset_name}",
                    transformations=["verified-depicts-subject", "served-locally"],
                )
            )
        write_pool_registry(records, args.registry)
        print(
            f"pool registry: {len(records)} records "
            f"({skipped_floor} below resolution floor) -> {args.registry}"
        )
    elif args.command == "download":
        records = read_pool_registry(args.registry)
        candidates = load_candidates(args.candidates)
        by_page = {c["file_page_url"]: c for c in candidates.values()}
        count = 0
        for record in records:
            entry = by_page.get(record["source_url"])
            if entry is None:
                raise SystemExit(f"no candidate URL for {record['source_url']}")
            destination = args.assets_dir / Path(record["asset_url"]).name
            if destination.is_file():
                continue
            download_asset(entry["file_url"], destination)
            count += 1
        print(f"pool download: {count} new files, {len(records)} records -> {args.assets_dir}")
    elif args.command == "revalidate":
        from .mediawiki import MediaWikiClient

        records = read_pool_registry(args.registry)
        client = MediaWikiClient(api_url=args.api_url, user_agent=USER_AGENT)
        report = [revalidate_record(client, record) for record in records]
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        failed = sum(1 for item in report if not item["ok"])
        print(f"pool revalidation: {len(report) - failed}/{len(report)} ok -> {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
