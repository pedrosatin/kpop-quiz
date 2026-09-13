"""Versioned policy for sources cited by Wikidata references."""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address
from urllib.parse import urlparse


SOURCE_POLICY_VERSION = "sources-v2"
RELIABLE = "reliable"
UNRELIABLE = "unreliable"
UNREVIEWED = "unreviewed"

# This local subset covers only suffixes reviewed for the observed source sample.
# Unknown suffixes remain unreviewed instead of falling back to the last two labels.
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

# Reviewed sources. Official sites of agencies and groups are primary sources for
# membership and birth dates. News outlets and charts have editorial control.
RELIABLE_SOURCES = frozenset(
    {
        # Agencies and official group sites.
        "domain:jype.com",
        "domain:smtown.com",
        "domain:ygfamily.com",
        "domain:hybecorp.com",
        "domain:ibighit.com",
        "domain:cubeent.co.kr",
        "domain:pledis.co.kr",
        "domain:4min.co.kr",
        "domain:after--school.jp",
        "domain:twicejapan.com",
        # News and charts.
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

# User-generated catalogs, fan wikis, sites derived from Wikipedia and the
# Wikimedia projects themselves.
UNRELIABLE_SOURCES = frozenset(
    {
        "wikidata:Q3561957",  # ČSFD
        "domain:csfd.cz",
        "wikidata:Q37312",  # IMDb
        "domain:imdb.com",
        "wikidata:Q504063",  # Discogs
        "domain:discogs.com",
        "wikidata:Q14005",  # MusicBrainz
        "domain:musicbrainz.org",
        "wikidata:Q328",  # English Wikipedia
        "wikidata:Q52",  # Wikipedia
        "wikidata:Q2013",  # Wikidata
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
