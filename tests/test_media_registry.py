"""Unit tests for media registry and license validation."""

import unittest
from copy import deepcopy

from kpop_scraping.media_registry import (
    PERMITTED_LICENSES,
    validate_licensed_media,
)
from kpop_scraping.quiz_schema import (
    _validate_question,
    validate_dataset,
    validate_session,
)


def sample_media() -> dict:
    return {
        "asset_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Twice_photo.jpg/960px-Twice_photo.jpg",
        "source_url": "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg",
        "creator": "Dispatch",
        "license_name": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "subject_qid": "Q21461452",
        "verified_at": "2026-01-15",
        "transformations": ["crop 4:5", "resize 960x1200"],
    }


def sample_question() -> dict:
    return {
        "id": "a" * 64,
        "logical_id": "b" * 64,
        "base_logical_id": "c" * 64,
        "semantic_id": "d" * 64,
        "fact_base_ids": ["fb-1"],
        "language": "pt-BR",
        "type": "formation_year",
        "theme": "history",
        "play_mode": "standard",
        "challenge_rating": "medium",
        "base_points": 100,
        "hint_cost": 15,
        "clues_available": [],
        "clues_shown": [],
        "group_ids": ["Q21461452"],
        "prompt": "Em que ano o grupo TWICE foi formado?",
        "options": [
            {"id": "1" * 64, "label": "2015", "value": "2015", "value_type": "time"},
            {"id": "2" * 64, "label": "2014", "value": "2014", "value_type": "time"},
            {"id": "3" * 64, "label": "2016", "value": "2016", "value_type": "time"},
            {"id": "4" * 64, "label": "2017", "value": "2017", "value_type": "time"},
        ],
        "answer_option_id": "1" * 64,
        "explanation": "TWICE foi formado em 2015 pela JYP Entertainment.",
        "reference_date": "2026-01-01",
        "evidence": [
            {
                "fact_base_id": "fb-1",
                "locator": "lead",
                "revision_id": 100,
                "source_key": "wikidata",
                "source_url": "https://www.wikidata.org/wiki/Q21461452",
            }
        ],
    }


class MediaRegistryTest(unittest.TestCase):
    def test_valid_media_record(self):
        media = sample_media()
        # Should validate without error
        validate_licensed_media(media)

    def test_all_permitted_licenses_pass(self):
        for license_name in PERMITTED_LICENSES:
            with self.subTest(license_name=license_name):
                media = sample_media()
                media["license_name"] = license_name
                validate_licensed_media(media)

    def test_missing_required_fields(self):
        required_fields = [
            "asset_url",
            "source_url",
            "creator",
            "license_name",
            "license_url",
            "subject_qid",
            "verified_at",
            "transformations",
        ]
        for field in required_fields:
            with self.subTest(field=field):
                media = sample_media()
                del media[field]
                with self.assertRaises(ValueError) as ctx:
                    validate_licensed_media(media)
                self.assertIn("missing required fields", str(ctx.exception))

    def test_extra_field_rejected(self):
        media = sample_media()
        media["unknown_field"] = "unexpected"
        with self.assertRaises(ValueError) as ctx:
            validate_licensed_media(media)
        self.assertIn("unexpected fields", str(ctx.exception))

    def test_prohibited_licenses_rejected(self):
        prohibited = [
            "CC BY-NC 4.0",
            "CC BY-NC-SA 4.0",
            "CC BY-ND 4.0",
            "CC BY-NC 3.0",
            "fair use",
            "Fair Use",
            "All Rights Reserved",
            "Copyrighted",
            "GPL 3.0",
            "Proprietary",
            "",
        ]
        for lic in prohibited:
            with self.subTest(license_name=lic):
                media = sample_media()
                media["license_name"] = lic
                with self.assertRaises(ValueError) as ctx:
                    validate_licensed_media(media)
                self.assertIn("license", str(ctx.exception).lower())

    def test_invalid_date_formats(self):
        invalid_dates = [
            "2026/01/15",
            "15-01-2026",
            "2026-02-30",  # invalid calendar day
            "2026-13-01",  # invalid month
            "2026-00-01",
            "2026-1-1",
            "not-a-date",
            "",
            12345,
        ]
        for invalid_date in invalid_dates:
            with self.subTest(verified_at=invalid_date):
                media = sample_media()
                media["verified_at"] = invalid_date
                with self.assertRaises(ValueError) as ctx:
                    validate_licensed_media(media)
                self.assertIn("verified_at", str(ctx.exception))

    def test_invalid_subject_qid(self):
        invalid_qids = [
            "Q0",
            "Q01",
            "P31",
            "21461452",
            "Q",
            "q21461452",
            "Q123a",
            "",
            None,
        ]
        for qid in invalid_qids:
            with self.subTest(subject_qid=qid):
                media = sample_media()
                media["subject_qid"] = qid
                with self.assertRaises(ValueError) as ctx:
                    validate_licensed_media(media)
                self.assertIn("subject_qid", str(ctx.exception))

    def test_empty_or_invalid_transformations(self):
        invalid_transforms = [
            [],
            [""],
            ["   "],
            [123],
            "crop 4:5",
            None,
        ]
        for transforms in invalid_transforms:
            with self.subTest(transformations=transforms):
                media = sample_media()
                media["transformations"] = transforms
                with self.assertRaises(ValueError) as ctx:
                    validate_licensed_media(media)
                self.assertIn("transformations", str(ctx.exception))

    def test_invalid_urls(self):
        # asset_url must be http or https
        media = sample_media()
        media["asset_url"] = "ftp://example.com/photo.jpg"
        with self.assertRaises(ValueError) as ctx:
            validate_licensed_media(media)
        self.assertIn("asset_url", str(ctx.exception))

        # source_url must be https
        media = sample_media()
        media["source_url"] = "http://commons.wikimedia.org/wiki/File:Twice_photo.jpg"
        with self.assertRaises(ValueError) as ctx:
            validate_licensed_media(media)
        self.assertIn("source_url", str(ctx.exception))

        # license_url must be http or https
        media = sample_media()
        media["license_url"] = "javascript:alert(1)"
        with self.assertRaises(ValueError) as ctx:
            validate_licensed_media(media)
        self.assertIn("license_url", str(ctx.exception))

    def test_empty_creator(self):
        media = sample_media()
        media["creator"] = "   "
        with self.assertRaises(ValueError) as ctx:
            validate_licensed_media(media)
        self.assertIn("creator", str(ctx.exception))

    def test_non_dict_media(self):
        with self.assertRaises(ValueError) as ctx:
            validate_licensed_media(["not", "a", "dict"])
        self.assertIn("dictionary", str(ctx.exception))


class QuizSchemaMediaIntegrationTest(unittest.TestCase):
    def test_question_without_media_is_valid(self):
        q = sample_question()
        _validate_question(q)

    def test_question_with_valid_media_is_valid(self):
        q = sample_question()
        q["media"] = sample_media()
        _validate_question(q)

    def test_question_with_invalid_media_fails(self):
        q = sample_question()
        q["media"] = sample_media()
        q["media"]["license_name"] = "CC BY-NC 4.0"
        with self.assertRaises(ValueError) as ctx:
            _validate_question(q)
        self.assertIn("license", str(ctx.exception).lower())

    def test_question_with_none_media_fails(self):
        q = sample_question()
        q["media"] = None
        with self.assertRaises(ValueError) as ctx:
            _validate_question(q)
        self.assertIn("question.media", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
