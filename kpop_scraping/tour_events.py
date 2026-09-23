"""Pure validation for normalized, non-persisted tour event candidates."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from urllib.parse import urlsplit
from uuid import UUID


QID_PATTERN = re.compile(r"Q[1-9][0-9]*\Z")
ISO_ALPHA2_PATTERN = re.compile(r"[A-Z]{2}\Z")
REQUIRED_FIELDS = frozenset(
    {
        "source_url",
        "subject_wikidata_id",
        "artist_musicbrainz_mbid",
        "event_mbid",
        "event_date",
        "event_type",
        "event_status",
        "billing_role",
        "place_mbid",
        "city_area_mbid",
        "country_wikidata_id",
        "country_iso_3166_1",
    }
)
OPTIONAL_FIELDS = frozenset({"tour_mbid"})


@dataclass(frozen=True)
class CountryIdentity:
    wikidata_id: str
    iso_3166_1: str


@dataclass(frozen=True)
class TourEventContext:
    """Reviewed reference data supplied by the caller, never inferred by names."""

    approved_source_hosts: frozenset[str]
    reviewed_group_artists: Mapping[str, frozenset[str]]
    reviewed_event_artists: Mapping[str, frozenset[str]]
    place_city_relations: Mapping[str, frozenset[str]]
    city_countries: Mapping[str, Sequence[CountryIdentity]]


@dataclass(frozen=True)
class NormalizedTourEvent:
    source_url: str
    source_host: str
    subject_wikidata_id: str
    artist_musicbrainz_mbid: str
    event_mbid: str
    event_date: str
    event_type: str
    event_status: str
    billing_role: str
    place_mbid: str
    city_area_mbid: str
    country_wikidata_id: str
    country_iso_3166_1: str
    tour_mbid: str | None = None
    status: str = "candidate"


@dataclass(frozen=True)
class TourEventAssessment:
    normalized: NormalizedTourEvent | None
    issues: tuple[str, ...]
    ready_for_editor_review: bool


def assess_tour_event_candidate(
    payload: Mapping[str, object], context: TourEventContext
) -> TourEventAssessment:
    """Check a candidate against reviewed IDs without accepting or storing it.

    A ready result still has ``status='candidate'``. An editor must review its
    primary-source evidence before any later workflow can accept the event.
    """
    issues: list[str] = []
    missing = REQUIRED_FIELDS - payload.keys()
    unknown = payload.keys() - REQUIRED_FIELDS - OPTIONAL_FIELDS
    issues.extend(f"missing_field:{field}" for field in sorted(missing))
    issues.extend(f"unknown_field:{field}" for field in sorted(unknown))
    if missing:
        return TourEventAssessment(None, tuple(issues), False)

    values = {key: payload[key] for key in REQUIRED_FIELDS | (OPTIONAL_FIELDS & payload.keys())}
    if any(not isinstance(value, str) for value in values.values()):
        return TourEventAssessment(None, ("field_not_string",), False)
    string_values = {key: str(value) for key, value in values.items()}

    source_url = string_values["source_url"]
    try:
        parsed_url = urlsplit(source_url)
        source_host = (parsed_url.hostname or "").lower().rstrip(".")
        source_port = parsed_url.port
        has_credentials = parsed_url.username is not None or parsed_url.password is not None
    except ValueError:
        parsed_url = None
        source_host = ""
        source_port = None
        has_credentials = True
    if (
        parsed_url is None
        or parsed_url.scheme.lower() != "https"
        or not source_host
        or has_credentials
        or source_port not in {None, 443}
    ):
        issues.append("invalid_source_url")
    elif source_host not in context.approved_source_hosts:
        issues.append("source_host_not_approved")

    group_id = string_values["subject_wikidata_id"]
    if not QID_PATTERN.fullmatch(group_id):
        issues.append("invalid_subject_wikidata_id")

    for field in (
        "artist_musicbrainz_mbid",
        "event_mbid",
        "place_mbid",
        "city_area_mbid",
    ):
        if not _is_canonical_mbid(string_values[field]):
            issues.append(f"invalid_{field}")

    event_id = string_values["event_mbid"]
    artist_id = string_values["artist_musicbrainz_mbid"]
    group_artists = context.reviewed_group_artists.get(group_id, frozenset())
    if not group_artists:
        issues.append("group_artist_binding_unreviewed")
    elif len(group_artists) > 1:
        issues.append("group_artist_binding_ambiguous")
    elif artist_id not in group_artists:
        issues.append("group_artist_binding_mismatch")
    if artist_id not in context.reviewed_event_artists.get(event_id, frozenset()):
        issues.append("event_artist_binding_unreviewed")

    event_date = string_values["event_date"]
    if not _is_iso_date(event_date):
        issues.append("invalid_event_date")
    if string_values["event_type"] != "concert":
        issues.append("unsupported_event_type")
    if string_values["billing_role"] not in {"headliner", "co_headliner"}:
        issues.append("ineligible_billing_role")
    if string_values["event_status"] not in {"scheduled", "completed", "cancelled"}:
        issues.append("invalid_event_status")
    elif string_values["event_status"] == "cancelled":
        issues.append("event_cancelled")

    place_id = string_values["place_mbid"]
    city_id = string_values["city_area_mbid"]
    place_cities = context.place_city_relations.get(place_id, frozenset())
    if not place_cities:
        issues.append("place_city_relation_unreviewed")
    elif len(place_cities) > 1:
        issues.append("place_city_relation_ambiguous")
    elif city_id not in place_cities:
        issues.append("place_city_relation_mismatch")

    country_id = string_values["country_wikidata_id"]
    country_iso = string_values["country_iso_3166_1"]
    if not QID_PATTERN.fullmatch(country_id):
        issues.append("invalid_country_wikidata_id")
    if not ISO_ALPHA2_PATTERN.fullmatch(country_iso):
        issues.append("invalid_country_iso_3166_1")
    city_matches = context.city_countries.get(city_id, ())
    if not city_matches:
        issues.append("city_country_unresolved")
    elif len(city_matches) > 1:
        issues.append("city_country_ambiguous")
    elif (
        city_matches[0].wikidata_id != country_id
        or city_matches[0].iso_3166_1 != country_iso
    ):
        issues.append("country_identity_mismatch")

    tour_id = string_values.get("tour_mbid")
    if tour_id is not None and not _is_canonical_mbid(tour_id):
        issues.append("invalid_tour_mbid")

    normalized = NormalizedTourEvent(
        source_url=source_url,
        source_host=source_host,
        subject_wikidata_id=group_id,
        artist_musicbrainz_mbid=artist_id,
        event_mbid=event_id,
        event_date=event_date,
        event_type=string_values["event_type"],
        event_status=string_values["event_status"],
        billing_role=string_values["billing_role"],
        place_mbid=place_id,
        city_area_mbid=city_id,
        country_wikidata_id=country_id,
        country_iso_3166_1=country_iso,
        tour_mbid=tour_id,
    )
    unique_issues = tuple(dict.fromkeys(issues))
    return TourEventAssessment(
        normalized=normalized,
        issues=unique_issues,
        ready_for_editor_review=not unique_issues,
    )


def _is_canonical_mbid(value: str) -> bool:
    try:
        return str(UUID(value)) == value
    except (ValueError, AttributeError):
        return False


def _is_iso_date(value: str) -> bool:
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False
