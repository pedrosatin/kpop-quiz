import unittest
from scripts.build_map_pilot_map import build_map


class BuildMapPilotMapTest(unittest.TestCase):
    def test_build_map_happy_path(self):
        features = {
            "features": [
                {
                    "properties": {
                        "ADM0_A3": "CAN",
                        "ADMIN": "Canada",
                        "WIKIDATAID": "Q16",
                        "ISO_A2": "CA",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    },
                }
            ]
        }

        result = build_map(features)

        self.assertEqual(result["schema_version"], "natural-earth-map-paths-v2")
        self.assertEqual(result["dataset"]["name"], "Natural Earth Admin 0 - Countries")
        self.assertEqual(len(result["features"]), 1)

        can_feature = result["features"][0]
        self.assertEqual(can_feature["id"], "CAN")
        self.assertEqual(can_feature["label"], "Canada")
        self.assertEqual(can_feature["wikidata_id"], "Q16")
        self.assertEqual(can_feature["iso_a2"], "CA")
        self.assertTrue(len(can_feature["path"]) > 0)

    def test_build_map_label_fallback(self):
        features = {
            "features": [
                {
                    "properties": {
                        "ADM0_A3": "USA",
                        "WIKIDATAID": "Q30",
                        "ISO_A2": "US",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    },
                }
            ]
        }

        result = build_map(features)

        self.assertEqual(len(result["features"]), 1)
        usa_feature = result["features"][0]
        self.assertEqual(usa_feature["id"], "USA")
        self.assertEqual(
            usa_feature["label"], "USA"
        )  # Fallback to ADM0_A3 since ADMIN is missing

    def test_build_map_filtering_logic(self):
        features = {
            "features": [
                {
                    "properties": {"ADM0_A3": "CAN", "ADMIN": "Canada"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    },
                },
                {
                    "properties": {"ADM0_A3": "MEX"},
                    "geometry": None,  # Should be filtered out
                },
                {
                    "properties": {"ADMIN": "Nowhere"},
                    "geometry": {  # Should be filtered out because no ADM0_A3
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    },
                },
            ]
        }

        result = build_map(features)
        self.assertEqual(len(result["features"]), 1)
        self.assertEqual(result["features"][0]["id"], "CAN")

    def test_build_map_sorting(self):
        features = {
            "features": [
                {
                    "properties": {"ADM0_A3": "ZWE", "ADMIN": "Zimbabwe"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    },
                },
                {
                    "properties": {"ADM0_A3": "ARG", "ADMIN": "Argentina"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    },
                },
            ]
        }

        result = build_map(features)
        self.assertEqual(len(result["features"]), 2)
        self.assertEqual(result["features"][0]["id"], "ARG")
        self.assertEqual(result["features"][1]["id"], "ZWE")

    def test_build_map_structural_defaults(self):
        # Empty dict should be handled gracefully
        result1 = build_map({})
        self.assertEqual(len(result1["features"]), 0)

        # Missing properties
        features = {
            "features": [
                {
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [10, 0], [0, 10], [0, 0]]],
                    }
                }
            ]
        }
        result2 = build_map(features)
        self.assertEqual(len(result2["features"]), 0)


if __name__ == "__main__":
    unittest.main()
