from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from kpop_scraping.country_crosswalk import (
    build_country_crosswalk,
    validate_country_crosswalk,
)

REAL_DATA_FIXTURE = Path(__file__).parent / "fixtures" / "natural_earth_511_country_sample.json"


def synthetic_features() -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"ADM0_A3": "AAA", "ISO_A2": "AA", "NAME": "Unjoined label"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "BBB", "ISO_A2": "BB", "NAME": "Another label"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "CCC", "ISO_A2": "CC", "NAME": "Duplicate one"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "CCD", "ISO_A2": "CC", "NAME": "Duplicate two"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "EEE", "ISO_A2": "-99", "NAME": "No ISO"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "bad_id", "ISO_A2": "FF", "NAME": "Malformed ID"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "FFF", "ISO_A2": "FF", "NAME": "Valid duplicate"}, "geometry": None},
            {"type": "Feature", "properties": {"ADM0_A3": "invalid", "ISO_A2": "GG", "NAME": "Only malformed ID"}, "geometry": None},
        ],
    }


def synthetic_countries() -> list[dict[str, str]]:
    return [
        {"wikidata_id": "Q990000001", "iso_3166_1": "AA"},
        {"wikidata_id": "Q990000002", "iso_3166_1": "BB"},
        {"wikidata_id": "Q990000003", "iso_3166_1": "CC"},
        {"wikidata_id": "Q990000004", "iso_3166_1": "DD"},
        {"wikidata_id": "Q990000005", "iso_3166_1": "FF"},
        {"wikidata_id": "Q990000006", "iso_3166_1": "GG"},
    ]


class CountryCrosswalkTests(unittest.TestCase):
    def build(self, features=None, countries=None):
        return build_country_crosswalk(
            features or synthetic_features(),
            countries or synthetic_countries(),
            dataset_version="synthetic-1",
            scale="synthetic-scale",
        )

    def test_builds_id_based_matches_and_reports_missing_or_ambiguous_features(self):
        report = self.build()

        self.assertEqual(
            report["matched_countries"],
            [
                {"wikidata_id": "Q990000001", "iso_3166_1": "AA", "map_feature_id": "AAA"},
                {"wikidata_id": "Q990000002", "iso_3166_1": "BB", "map_feature_id": "BBB"},
            ],
        )
        self.assertEqual(
            report["unresolved_countries"],
            [
                {"wikidata_id": "Q990000003", "iso_3166_1": "CC", "reason": "feature_ambiguous"},
                {"wikidata_id": "Q990000004", "iso_3166_1": "DD", "reason": "feature_missing"},
                {"wikidata_id": "Q990000005", "iso_3166_1": "FF", "reason": "feature_ambiguous"},
                {"wikidata_id": "Q990000006", "iso_3166_1": "GG", "reason": "feature_invalid_id"},
            ],
        )
        self.assertEqual(report["feature_count"], len(synthetic_features()["features"]))
        self.assertEqual(report["invalid_feature_count"], 3)
        validate_country_crosswalk(report)

    def test_reproducible_order_and_ignores_display_names(self):
        features = synthetic_features()
        first = self.build(features=features)
        reordered = self.build(features={**features, "features": list(reversed(features["features"]))})
        renamed = copy.deepcopy(features)
        for feature in renamed["features"]:
            feature["properties"]["NAME"] = "A different display label"

        self.assertEqual(first, reordered)
        self.assertEqual(first["crosswalk_id"], self.build(features=renamed)["crosswalk_id"])

    def test_country_sample_matches_natural_earth_511_property_ids(self):
        fixture = json.loads(REAL_DATA_FIXTURE.read_text(encoding="utf-8"))
        report = build_country_crosswalk(
            {"type": "FeatureCollection", "features": fixture["features"]},
            fixture["reviewed_countries"],
            dataset_version=fixture["dataset_version"],
            scale=fixture["scale"],
        )

        self.assertEqual(
            [(row["wikidata_id"], row["map_feature_id"]) for row in report["matched_countries"]],
            [("Q252", "IDN"), ("Q836", "MMR"), ("Q884", "KOR")],
        )
        self.assertEqual(report["unresolved_countries"], [])

    def test_rejects_duplicate_catalog_ids_and_invalid_input_shape(self):
        countries = synthetic_countries()
        countries.append({"wikidata_id": "Q990000009", "iso_3166_1": "AA"})
        with self.assertRaisesRegex(ValueError, "duplicate reviewed country ISO code"):
            self.build(countries=countries)
        with self.assertRaisesRegex(ValueError, "GeoJSON FeatureCollection"):
            self.build(features={"type": "FeatureCollection", "features": "bad"})

    def test_validator_rejects_duplicate_feature_mapping_and_tampering(self):
        report = self.build()
        duplicate_feature = copy.deepcopy(report)
        duplicate_feature["matched_countries"][1]["map_feature_id"] = "AAA"
        duplicate_feature["crosswalk_id"] = self.build()["crosswalk_id"]
        with self.assertRaisesRegex(ValueError, "duplicate map feature ID"):
            validate_country_crosswalk(duplicate_feature)

        tampered = copy.deepcopy(report)
        tampered["matched_countries"][0]["map_feature_id"] = "ZZZ"
        with self.assertRaisesRegex(ValueError, "crosswalk_id does not match content"):
            validate_country_crosswalk(tampered)


if __name__ == "__main__":
    unittest.main()
