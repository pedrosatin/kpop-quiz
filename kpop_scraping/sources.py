"""Versioned policy for sources cited by Wikidata references."""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address
from urllib.parse import urlparse

SOURCE_POLICY_VERSION = "sources-v2"
RELIABLE = "reliable"
UNRELIABLE = "unreliable"
UNREVIEWED = "unreviewed"

_TWO_LABEL_SUFFIXES = frozenset(
    {
        "co.kr", "or.kr", "ne.kr", "go.kr", "re.kr", "ac.kr",
        "co.jp", "ne.jp", "or.jp",
        "com.tw", "com.cn", "com.hk", "co.uk", "com.au", "com.br",
    }
)
_ONE_LABEL_SUFFIXES = frozenset(
    {"com", "org", "net", "kr", "jp", "cz", "wiki", "world"}
)

RELIABLE_SOURCES = frozenset(
    {
        "domain:jype.com",
        "domain:smtown.com",
        "domain:ygfamily.com",
        "domain:hybecorp.com",
        "domain:ibighit.com",
        "domain:cubeent.co.kr",
        "domain:pledis.co.kr",
        "domain:starship-ent.com",
        "domain:woolliment.com",
        "domain:rbbridge.com",
        "domain:kqent.com",
        "domain:fantagio.kr",
        "domain:istorient.com",
        "domain:wake-one.com",
        "domain:ador.world",
        "domain:sourcemusic.com",
        "domain:beliftlab.com",
        "domain:wment.co.kr",
        "domain:jelly-fish.co.kr",
        "domain:dspmedia.co.kr",
        "domain:topmedia.kr",
        "domain:4min.co.kr",
        "domain:after--school.jp",
        "domain:twicejapan.com",
        "domain:yna.co.kr",
        "domain:joins.com",
        "domain:koreaherald.com",
        "domain:koreatimes.co.kr",
        "domain:chosun.com",
        "domain:donga.com",
        "domain:hani.co.kr",
        "domain:billboard.com",
        "domain:circlechart.kr",
    }
)

UNRELIABLE_SOURCES = frozenset(
    {
        "wikidata:Q3561957",
        "domain:csfd.cz",
        "wikidata:Q37312",
        "domain:imdb.com",
        "wikidata:Q504063",
        "domain:discogs.com",
        "wikidata:Q14005",
        "domain:musicbrainz.org",
        "wikidata:Q328",
        "wikidata:Q52",
        "wikidata:Q2013",
        "domain:wikipedia.org",
        "domain:wikidata.org",
        "domain:wikimedia.org",
        "domain:famousbirthdays.com",
        "domain:pantheon.world",
        "domain:kprofiles.com",
        "domain:kpopsingers.com",
    }
)

@dataclass(frozen=True)
class SourceVerdict:
    key: str
    status: str

def registrable_domain(url: str) -> str | None:
    """Return a registrable domain only for the reviewed suffix subset."""
    try:
        parsed = urlparse(url.strip())
        host = parsed.hostname
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not host or "." not in host:
        return None
    labels = host.lower().rstrip(".").split(".")
    if any(
        not label
        or len(label) > 63
        or label.startswith("-")
        or label.endswith("-")
        or any(
            not (character.isascii() and (character.isalnum() or character == "-"))
            for character in label
        )
        for label in labels
    ):
        return None
    try:
        ip_address(host)
    except ValueError:
        pass
    else:
        return None
    suffix = ".".join(labels[-2:])
    if suffix in _TWO_LABEL_SUFFIXES:
        size = 3
    elif labels[-1] in _ONE_LABEL_SUFFIXES:
        size = 2
    else:
        return None
    return ".".join(labels[-size:]) if len(labels) >= size else None

def classify_source(key: str) -> str:
    if key.startswith("domain:"):
        domain = key.removeprefix("domain:")
        if registrable_domain(f"https://{domain}") != domain:
            return UNREVIEWED
    if key in RELIABLE_SOURCES:
        return RELIABLE
    if key in UNRELIABLE_SOURCES:
        return UNRELIABLE
    return UNREVIEWED
