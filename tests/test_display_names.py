"""Display-label casing and safe disambiguator stripping."""

from __future__ import annotations

import json
import unittest

from kpop_scraping.display_names import (
    OVERRIDES_PATH,
    apply_override,
    resolve_display_labels,
    strip_trailing_disambiguator,
)


def resolve_one(label: str | None, canonical: str, qid: str | None = None, locale: str | None = None) -> str:
    return resolve_display_labels([(label, canonical, qid)], locale)[0]


def resolve_many(entries: list[tuple[str | None, str]]) -> list[str]:
    return resolve_display_labels([(label, canonical, None) for label, canonical in entries])


# Labels that differ from canonical_name only by case in the published
# artifacts: source spellings that stay as published.
CASE_ONLY_PUBLISHED = [
    ("Ateez", "ATEEZ"),
    ("Mamamoo", "MAMAMOO"),
    ("Ive", "IVE"),
    ("tripleS", "TripleS"),
    ("izna", "Izna"),
    ("Sistar", "SISTAR"),
    ("Luv", "LUV"),
    ("Imfact", "IMFACT"),
    ("A Train To Autumn", "A Train to Autumn"),
]


class DisplayNamesTests(unittest.TestCase):
    def test_keeps_every_case_only_difference_as_published(self) -> None:
        for label, canonical in CASE_ONLY_PUBLISHED:
            with self.subTest(label=label, canonical=canonical):
                self.assertEqual(resolve_one(label, canonical), label)
                self.assertEqual(resolve_one(label, canonical, "Q1", "pt-BR"), label)

    def test_canonical_name_is_not_the_better_spelling(self) -> None:
        self.assertEqual(resolve_one("ATEEZ", "Ateez"), "ATEEZ")
        self.assertEqual(resolve_one("Ateez", "ATEEZ"), "Ateez")

    def test_reviewed_shinee_spelling_applies_only_to_the_published_label(self) -> None:
        self.assertEqual(apply_override("shinee", "Q269836", "pt-BR"), "SHINee")
        self.assertEqual(resolve_one("shinee", "SHINee", "Q269836", "pt-BR"), "SHINee")
        # Other locale, other entity, a label fixed upstream, or no scope: untouched.
        self.assertEqual(apply_override("shinee", "Q269836", "en"), "shinee")
        self.assertEqual(apply_override("shinee", "Q1", "pt-BR"), "shinee")
        self.assertEqual(apply_override("Shinee", "Q269836", "pt-BR"), "Shinee")
        self.assertEqual(apply_override("shinee", None, "pt-BR"), "shinee")
        self.assertEqual(apply_override("shinee", "Q269836", None), "shinee")
        self.assertEqual(resolve_one("shinee", "SHINee"), "shinee")

    def test_overrides_cite_pinned_source_revisions(self) -> None:
        table = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
        self.assertTrue(table["overrides"])
        for entry in table["overrides"]:
            with self.subTest(qid=entry["qid"]):
                self.assertRegex(entry["qid"], r"^Q[1-9][0-9]*$")
                self.assertNotEqual(entry["display"], entry["published"])
                self.assertTrue(entry["evidence"])
                for item in entry["evidence"]:
                    self.assertRegex(item["locator"], r"revid=\d+")
                    self.assertTrue(item["source_url"].startswith("https://"))

    def test_keeps_boyfriend_bf_when_strings_differ(self) -> None:
        # EN Wikidata label BF vs PT Boyfriend: different identities, leave alone.
        self.assertEqual(resolve_one("Boyfriend", "BF"), "Boyfriend")
        self.assertEqual(resolve_one("BF", "BF"), "BF")

    def test_strips_unique_disambiguators(self) -> None:
        labels = resolve_many(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Uniq (banda)", "Uniq"),
                ("Luv (grupo sul-coreano)", "LUV"),
                ("Everglow", "Everglow"),
            ]
        )
        self.assertEqual(labels, ["Tempest", "Uniq", "Luv", "Everglow"])

    def test_keeps_disambiguator_when_homonym(self) -> None:
        labels = resolve_many(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Tempest (banda)", "Tempest (banda)"),
            ]
        )
        self.assertEqual(labels, ["Tempest (grupo)", "Tempest (banda)"])

    def test_keeps_disambiguator_when_homonyms_share_the_canonical_name(self) -> None:
        # Both pages are "Tempest" on Wikidata; only the Wikipedia note differs.
        labels = resolve_many(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Tempest (banda)", "Tempest"),
            ]
        )
        self.assertEqual(labels, ["Tempest (grupo)", "Tempest (banda)"])

    def test_homonym_guard_ignores_case_between_peers(self) -> None:
        labels = resolve_many(
            [
                ("Luv (grupo)", "LUV"),
                ("LUV (banda)", "LUV"),
            ]
        )
        self.assertEqual(labels, ["Luv (grupo)", "LUV (banda)"])

    def test_unrelated_peers_do_not_block_stripping(self) -> None:
        labels = resolve_many(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Everglow", "Everglow"),
                ("Tempest Two", "Tempest Two"),
            ]
        )
        self.assertEqual(labels, ["Tempest", "Everglow", "Tempest Two"])

    def test_keeps_disambiguator_against_bare_peer(self) -> None:
        labels = resolve_many(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Tempest", "Tempest"),
            ]
        )
        self.assertEqual(labels, ["Tempest (grupo)", "Tempest"])

    def test_preserves_internal_and_non_wiki_parentheses(self) -> None:
        self.assertEqual(strip_trailing_disambiguator("f(x)"), "f(x)")
        self.assertEqual(resolve_one("f(x)", "f(x)"), "f(x)")
        self.assertEqual(
            strip_trailing_disambiguator("+(Kr)ystal Eyes"),
            "+(Kr)ystal Eyes",
        )
        self.assertEqual(strip_trailing_disambiguator("SHINee (pt)"), "SHINee (pt)")
        self.assertEqual(
            strip_trailing_disambiguator("April (girl group)"),
            "April",
        )
        self.assertEqual(
            strip_trailing_disambiguator("Aimers (band)"),
            "Aimers",
        )
        self.assertEqual(
            strip_trailing_disambiguator("IZ (grupo musical)"),
            "IZ",
        )
        self.assertEqual(
            strip_trailing_disambiguator("B.O.Y (Grupo musical)"),
            "B.O.Y",
        )


if __name__ == "__main__":
    unittest.main()
