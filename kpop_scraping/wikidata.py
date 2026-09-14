"""Wikidata clients for catalog type checks and entity documents."""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any

from .mediawiki import MediaWikiClient, MediaWikiError


MAX_ENTITIES_PER_REQUEST = 50
WIKIDATA_ID = re.compile(r"^Q[1-9][0-9]*$")


@dataclass(frozen=True)
class TypeCheck:
    wikidata_id: str
    revision_id: int
    instance_of: tuple[str, ...]


@dataclass(frozen=True)
class EntityProfile:
    """Fixed request shape; the name is part of the snapshot identity."""

    name: str
    props: str
    languages: str = "pt|en|ko"
    sitefilter: str | None = None

    def parameters(self) -> dict[str, str]:
        parameters = {"props": self.props, "languages": self.languages}
        if self.sitefilter:
            parameters["sitefilter"] = self.sitefilter
        return parameters


SUBJECT_PROFILE = EntityProfile(
    name="subject-v1",
    props="info|labels|aliases|claims|sitelinks/urls",
    sitefilter="enwiki|ptwiki|kowiki",
)
LABEL_PROFILE = EntityProfile(name="label-v1", props="info|labels|aliases")
# Values that must be countries need P31, so they are requested with claims.
COUNTRY_PROFILE = EntityProfile(name="country-v1", props="info|labels|aliases|claims")


@dataclass(frozen=True)
class EntityDocument:
    """One entity object returned by wbgetentities for a requested QID."""

    requested_id: str
    wikidata_id: str
    revision_id: int
    payload: dict[str, Any] = field(compare=False, repr=False)

    @property
    def redirected(self) -> bool:
        return self.requested_id != self.wikidata_id


@dataclass(frozen=True)
class EntityBatch:
    documents: tuple[EntityDocument, ...]
    missing: tuple[str, ...]


def _is_missing(entity: Any) -> bool:
    # Wikibase returns "missing": "" for deleted items, even with formatversion=2.
    return not isinstance(entity, dict) or "missing" in entity


class WikidataTypeClient(MediaWikiClient):
    """Fetch only entity revision IDs and direct P31 values."""

    def __init__(
        self,
        api_url: str = "https://www.wikidata.org/w/api.php",
        user_agent: str = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-scraping)",
        timeout: float = 30,
        retries: int = 3,
    ) -> None:
        super().__init__(
            api_url=api_url,
            user_agent=user_agent,
            timeout=timeout,
            retries=retries,
            provider="wikidata",
            language="mul",
        )

    def get_type_checks(self, wikidata_ids: Iterable[str]) -> Iterator[TypeCheck]:
        ids = tuple(dict.fromkeys(wikidata_ids))
        if not ids:
            return
        if len(ids) > MAX_ENTITIES_PER_REQUEST:
            raise ValueError(
                f"get_type_checks accepts at most {MAX_ENTITIES_PER_REQUEST} IDs"
            )
        payload = self._get(
            {
                "action": "wbgetentities",
                "ids": "|".join(ids),
                "props": "claims|info",
            }
        )
        entities = payload.get("entities")
        if not isinstance(entities, dict):
            raise MediaWikiError("Wikidata entity response has an unexpected shape")
        for wikidata_id in ids:
            entity = entities.get(wikidata_id)
            if _is_missing(entity):
                continue
            revision_id = entity.get("lastrevid")
            if not isinstance(revision_id, int):
                raise MediaWikiError(
                    f"Wikidata entity {wikidata_id} has no revision ID"
                )
            yield TypeCheck(
                wikidata_id=wikidata_id,
                revision_id=revision_id,
                instance_of=_instance_of_values(entity),
            )


class WikidataEntityClient(WikidataTypeClient):
    """Fetch complete entity documents for fact extraction."""

    def get_entities(
        self,
        wikidata_ids: Iterable[str],
        profile: EntityProfile,
    ) -> EntityBatch:
        """Fetch at most 50 QIDs in one request.

        A nonexistent QID makes Wikibase fail the whole request with
        ``no-such-entity``. The client records that QID as missing and repeats
        the request without it, so each batch needs at most 50 extra calls.
        """
        pending = list(dict.fromkeys(wikidata_ids))
        if len(pending) > MAX_ENTITIES_PER_REQUEST:
            raise ValueError(
                f"get_entities accepts at most {MAX_ENTITIES_PER_REQUEST} IDs"
            )
        invalid = [value for value in pending if not WIKIDATA_ID.fullmatch(value)]
        if invalid:
            raise ValueError(f"invalid Wikidata item IDs: {invalid!r}")
        missing: list[str] = []
        while pending:
            try:
                payload = self._get(
                    {
                        "action": "wbgetentities",
                        "ids": "|".join(pending),
                        **profile.parameters(),
                    }
                )
            except MediaWikiError as exc:
                missing_id = exc.details.get("id") if exc.code == "no-such-entity" else None
                if missing_id not in pending:
                    raise
                pending.remove(missing_id)
                missing.append(missing_id)
                continue
            documents, batch_missing = _entity_documents(payload, pending)
            missing.extend(batch_missing)
            return EntityBatch(tuple(documents), tuple(missing))
        return EntityBatch((), tuple(missing))


def _entity_documents(
    payload: dict[str, Any],
    requested_ids: list[str],
) -> tuple[list[EntityDocument], list[str]]:
    entities = payload.get("entities")
    if not isinstance(entities, dict):
        raise MediaWikiError("Wikidata entity response has an unexpected shape")
    redirects = {
        entity["redirects"]["from"]: entity
        for entity in entities.values()
        if isinstance(entity, dict) and isinstance(entity.get("redirects"), dict)
    }
    documents: list[EntityDocument] = []
    missing: list[str] = []
    for requested_id in requested_ids:
        entity = entities.get(requested_id) or redirects.get(requested_id)
        if _is_missing(entity):
            missing.append(requested_id)
            continue
        wikidata_id = entity.get("id")
        revision_id = entity.get("lastrevid")
        if not isinstance(wikidata_id, str) or not WIKIDATA_ID.fullmatch(wikidata_id):
            raise MediaWikiError(f"Wikidata entity {requested_id} has no valid ID")
        if not isinstance(revision_id, int) or revision_id < 1:
            raise MediaWikiError(f"Wikidata entity {requested_id} has no revision ID")
        # "redirects" depends on the requested ID, not on the entity revision.
        # Keeping it would give the same revision two different hashes.
        payload = {key: value for key, value in entity.items() if key != "redirects"}
        documents.append(EntityDocument(requested_id, wikidata_id, revision_id, payload))
    return documents, missing


def _instance_of_values(entity: dict[str, Any]) -> tuple[str, ...]:
    values: list[str] = []
    for statement in entity.get("claims", {}).get("P31", []):
        snak = statement.get("mainsnak", {})
        value = snak.get("datavalue", {}).get("value", {})
        item_id = value.get("id")
        if snak.get("snaktype") == "value" and isinstance(item_id, str):
            values.append(item_id)
    return tuple(sorted(set(values)))
