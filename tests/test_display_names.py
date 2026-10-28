"""Display-label casing and safe disambiguator stripping."""

from __future__ import annotations

import unittest

from kpop_scraping.display_names import (
    align_case_to_canonical,
    resolve_display_label,
    resolve_display_labels,
    strip_trailing_disambiguator,
)


class DisplayNamesTests(unittest.TestCase):
    def test_aligns_shinee_case_to_canonical(self) -> None:
        self.assertEqual(align_case_to_canonical("shinee", "SHINee"), "SHINee")
        self.assertEqual(resolve_display_label("shinee", "SHINee"), "SHINee")

    def test_aligns_sistar_case_to_canonical(self) -> None:
        self.assertEqual(resolve_display_label("Sistar", "SISTAR"), "SISTAR")

    def test_keeps_boyfriend_bf_when_strings_differ(self) -> None:
        # EN Wikidata label BF vs PT Boyfriend: different identities, leave alone.
        self.assertEqual(resolve_display_label("Boyfriend", "BF"), "Boyfriend")
        self.assertEqual(resolve_display_label("BF", "BF"), "BF")

    def test_strips_unique_disambiguators(self) -> None:
        labels = resolve_display_labels(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Uniq (banda)", "Uniq"),
                ("Luv (grupo sul-coreano)", "LUV"),
                ("Everglow", "Everglow"),
            ]
        )
        self.assertEqual(labels, ["Tempest", "Uniq", "LUV", "Everglow"])

    def test_keeps_disambiguator_when_homonym(self) -> None:
        labels = resolve_display_labels(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Tempest (banda)", "Tempest (banda)"),
            ]
        )
        self.assertEqual(labels, ["Tempest (grupo)", "Tempest (banda)"])

    def test_keeps_disambiguator_against_bare_peer(self) -> None:
        labels = resolve_display_labels(
            [
                ("Tempest (grupo)", "Tempest"),
                ("Tempest", "Tempest"),
            ]
        )
        self.assertEqual(labels, ["Tempest (grupo)", "Tempest"])

    def test_preserves_internal_and_non_wiki_parentheses(self) -> None:
        self.assertEqual(strip_trailing_disambiguator("f(x)"), "f(x)")
        self.assertEqual(resolve_display_label("f(x)", "f(x)"), "f(x)")
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
