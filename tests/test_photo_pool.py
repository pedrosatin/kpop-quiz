import json
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.media_registry import PERMITTED_LICENSES
from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.photo_pool import (
    build_photo_record,
    candidate_asset_name,
    check_revalidation,
    file_page_title,
    license_deed_url,
    read_pool_registry,
    revalidate_record,
    select_verified_pool,
    strip_html_markup,
    validate_photo_verdict,
    write_pool_registry,
    main,
)


def make_verdict(**overrides):
    verdict = {
        "file_title": "File:Jennie Kim 2024.png",
        "subject_qid": "Q12345",
        "depicts_subject": True,
        "solo_portrait": True,
        "min_short_side_px": 480,
        "reviewer": "editor",
        "verified_at": "2026-10-02",
    }
    verdict.update(overrides)
    return verdict


def make_record(**overrides):
    record = {
        "asset_url": "https://kpopquiz.online/media/photo/Q12345-01-Jennie_Kim_2024.png",
        "source_url": "https://commons.wikimedia.org/wiki/File:Jennie_Kim_2024.png",
        "creator": "Fan Photographer",
        "license_name": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "subject_qid": "Q12345",
        "verified_at": "2026-10-02",
        "transformations": ["verified-depicts-subject", "served-locally"],
    }
    record.update(overrides)
    return record


class PhotoVerdictTest(unittest.TestCase):
    def test_valid_verdict_passes(self):
        validate_photo_verdict(make_verdict())

    def test_missing_field_rejected(self):
        verdict = make_verdict()
        del verdict["reviewer"]
        with self.assertRaises(ValueError):
            validate_photo_verdict(verdict)

    def test_non_dict_rejected(self):
        with self.assertRaises(ValueError):
            validate_photo_verdict("nope")

    def test_bad_qid_rejected(self):
        with self.assertRaises(ValueError):
            validate_photo_verdict(make_verdict(subject_qid="Jennie"))

    def test_non_boolean_verdict_rejected(self):
        with self.assertRaises(ValueError):
            validate_photo_verdict(make_verdict(depicts_subject="yes"))

    def test_bad_date_rejected(self):
        with self.assertRaises(ValueError):
            validate_photo_verdict(make_verdict(verified_at="10/02/2026"))
        with self.assertRaises(ValueError):
            validate_photo_verdict(make_verdict(verified_at="2026-13-40"))

    def test_non_positive_resolution_rejected(self):
        with self.assertRaises(ValueError):
            validate_photo_verdict(make_verdict(min_short_side_px=0))


class LicenseDeedTest(unittest.TestCase):
    def test_every_permitted_license_has_deed(self):
        for name in PERMITTED_LICENSES:
            self.assertTrue(license_deed_url(name).startswith("https://"))

    def test_commons_lowercase_public_domain_alias(self):
        self.assertEqual(
            license_deed_url("Public domain"),
            "https://creativecommons.org/publicdomain/mark/1.0/",
        )

    def test_unknown_license_raises_key_error(self):
        with self.assertRaises(KeyError):
            license_deed_url("CC BY-NC 4.0")

    def test_artist_html_stripped(self):
        self.assertEqual(
            strip_html_markup('<a href="//x">Fan</a> Photographer'),
            "Fan Photographer",
        )


class PhotoRecordTest(unittest.TestCase):
    def test_build_valid_record(self):
        record = build_photo_record(
            file_title="File:Jennie Kim 2024.png",
            file_page_url="https://commons.wikimedia.org/wiki/File:Jennie_Kim_2024.png",
            license_name="CC BY 3.0",
            creator="<i>Fancam Uploader</i>",
            subject_qid="Q12345",
            verified_at="2026-10-02",
            asset_path="https://kpopquiz.online/media/photo/Q12345-01-x.png",
            transformations=["verified-depicts-subject"],
        )
        self.assertEqual(record["license_url"], "https://creativecommons.org/licenses/by/3.0/")
        self.assertEqual(record["creator"], "Fancam Uploader")

    def test_unpermitted_license_rejected(self):
        with self.assertRaises(ValueError):
            build_photo_record(
                file_title="File:Cover.jpg",
                file_page_url="https://commons.wikimedia.org/wiki/File:Cover.jpg",
                license_name="All rights reserved",
                creator="Agency",
                subject_qid="Q12345",
                verified_at="2026-10-02",
                asset_path="https://kpopquiz.online/media/photo/Q12345-01-x.jpg",
                transformations=["verified-depicts-subject"],
            )

    def test_asset_name_sanitized_and_scoped(self):
        name = candidate_asset_name("File:Åhus kyrka-08.jpg", "Q999", 3)
        self.assertTrue(name.startswith("Q999-03-"))
        self.assertNotIn(" ", name)
        self.assertNotIn("å", name)


class PoolRegistryTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_round_trip(self):
        path = self.root / "pool.json"
        write_pool_registry([make_record()], path)
        self.assertEqual(read_pool_registry(path), [make_record()])

    def test_invalid_record_rejected_on_write(self):
        with self.assertRaises(ValueError):
            write_pool_registry([make_record(license_name="CC BY-NC 4.0")], self.root / "p.json")

    def test_wrong_schema_rejected_on_read(self):
        path = self.root / "pool.json"
        path.write_text(json.dumps({"schema_version": "other", "records": []}))
        with self.assertRaises(ValueError):
            read_pool_registry(path)

    def test_build_cli_end_to_end(self):
        candidates = [
            {
                "file_title": "File:Jennie Kim 2024.png",
                "file_url": "https://upload.wikimedia.org/x.png",
                "file_page_url": "https://commons.wikimedia.org/wiki/File:Jennie_Kim_2024.png",
                "license_name": "CC BY-SA 4.0",
                "creator": "Fan",
                "subject_qid": "Q12345",
                "width": 800,
                "height": 1200,
            }
        ]
        candidates_path = self.root / "candidates.json"
        candidates_path.write_text(json.dumps(candidates))
        verdicts_path = self.root / "verdicts.json"
        verdicts_path.write_text(
            json.dumps([make_verdict(), make_verdict(file_title="File:Other.png")])
        )
        registry_path = self.root / "pool.json"
        self.assertEqual(
            main(
                [
                    "build",
                    "--candidates",
                    str(candidates_path),
                    "--verdicts",
                    str(verdicts_path),
                    "--registry",
                    str(registry_path),
                ]
            ),
            0,
        )
        records = read_pool_registry(registry_path)
        self.assertEqual(len(records), 1)
        self.assertTrue(records[0]["asset_url"].startswith("https://kpopquiz.online/media/photo/"))


class BuildGateTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.candidates_path = self.root / "candidates.json"
        self.candidates_path.write_text(
            json.dumps(
                [
                    {
                        "file_title": "File:Jennie Kim 2024.png",
                        "file_url": "https://upload.wikimedia.org/x.png",
                        "file_page_url": "https://commons.wikimedia.org/wiki/File:Jennie_Kim_2024.png",
                        "license_name": "CC BY-SA 4.0",
                        "creator": "Fan",
                        "subject_qid": "Q12345",
                        "width": 800,
                        "height": 1200,
                    }
                ]
            )
        )

    def tearDown(self):
        self.tempdir.cleanup()

    def test_below_floor_verdicts_skipped(self):
        verdicts_path = self.root / "verdicts.json"
        verdicts_path.write_text(
            json.dumps([make_verdict_for("File:Jennie Kim 2024.png", "Q12345", 100)])
        )
        registry_path = self.root / "pool.json"
        self.assertEqual(
            main(
                [
                    "build",
                    "--candidates",
                    str(self.candidates_path),
                    "--verdicts",
                    str(verdicts_path),
                    "--registry",
                    str(registry_path),
                ]
            ),
            0,
        )
        self.assertEqual(read_pool_registry(registry_path), [])

    def test_subject_mismatch_fails_fast(self):
        verdicts_path = self.root / "verdicts.json"
        verdicts_path.write_text(
            json.dumps([make_verdict_for("File:Jennie Kim 2024.png", "Q99999", 480)])
        )
        registry_path = self.root / "pool.json"
        with self.assertRaises(SystemExit):
            main(
                [
                    "build",
                    "--candidates",
                    str(self.candidates_path),
                    "--verdicts",
                    str(verdicts_path),
                    "--registry",
                    str(registry_path),
                ]
            )

    def test_malformed_candidates_fails_cleanly(self):
        bad = self.root / "bad.json"
        bad.write_text(json.dumps({"not": "a list"}))
        verdicts_path = self.root / "verdicts.json"
        verdicts_path.write_text(json.dumps([]))
        self.assertEqual(
            main(
                [
                    "build",
                    "--candidates",
                    str(bad),
                    "--verdicts",
                    str(verdicts_path),
                    "--registry",
                    str(self.root / "pool.json"),
                ]
            ),
            2,
        )


def make_verdict_for(file_title, subject_qid, short_side):
    return {
        "file_title": file_title,
        "subject_qid": subject_qid,
        "depicts_subject": True,
        "solo_portrait": True,
        "min_short_side_px": short_side,
        "reviewer": "editor",
        "verified_at": "2026-10-03",
    }


class VerifiedPoolSelectionTest(unittest.TestCase):
    def test_minimum_per_idol_enforced(self):
        verdicts = [
            make_verdict(file_title="File:A1.png", subject_qid="Q1"),
            make_verdict(file_title="File:A2.png", subject_qid="Q1"),
            make_verdict(file_title="File:B1.png", subject_qid="Q2"),
        ]
        pool = select_verified_pool(verdicts, min_per_idol=2)
        self.assertEqual(set(pool), {"Q1"})

    def test_negative_verdicts_excluded(self):
        verdicts = [
            make_verdict(file_title="File:A1.png", subject_qid="Q1"),
            make_verdict(file_title="File:A2.png", subject_qid="Q1", depicts_subject=False),
            make_verdict(file_title="File:A3.png", subject_qid="Q1", solo_portrait=False),
        ]
        self.assertEqual(select_verified_pool(verdicts, min_per_idol=2), {})

    def test_below_floor_verdicts_excluded_from_selection(self):
        verdicts = [
            make_verdict(
                file_title="File:A1.png",
                subject_qid="Q1",
                min_short_side_px=399,
            ),
            make_verdict(
                file_title="File:A2.png",
                subject_qid="Q1",
                min_short_side_px=400,
            ),
        ]
        self.assertEqual(select_verified_pool(verdicts, min_per_idol=1), {"Q1": [verdicts[1]]})


class RevalidateRecordTest(unittest.TestCase):
    def test_queries_exact_file_title_once(self):
        seen = []

        class StubClient:
            def _get(self, parameters):
                seen.append(parameters["titles"])
                return {
                    "query": {
                        "pages": [
                            {
                                "imageinfo": [
                                    {
                                        "extmetadata": {
                                            "LicenseShortName": {"value": "CC BY-SA 4.0"}
                                        },
                                        "mediatype": "BITMAP",
                                    }
                                ]
                            }
                        ]
                    }
                }

        result = revalidate_record(StubClient(), make_record())
        self.assertEqual(seen, ["File:Jennie Kim 2024.png"])
        self.assertTrue(result["ok"])

    def test_client_error_recorded_not_raised(self):
        class FailingClient:
            def _get(self, _parameters):
                raise MediaWikiError("boom")

        result = revalidate_record(FailingClient(), make_record())
        self.assertFalse(result["ok"])
        self.assertTrue(result["reasons"])

    def test_file_page_title_keeps_extension(self):
        self.assertEqual(
            file_page_title("https://commons.wikimedia.org/wiki/File:Jennie_Kim_2024.png"),
            "File:Jennie Kim 2024.png",
        )


class RevalidationTest(unittest.TestCase):
    def test_unchanged_record_ok(self):
        stored = make_record()
        fresh = {"license_name": "CC BY-SA 4.0", "mediatype": "BITMAP"}
        self.assertEqual(check_revalidation(stored, fresh), {"ok": True, "reasons": []})

    def test_missing_file_fails_closed(self):
        result = check_revalidation(make_record(), None)
        self.assertFalse(result["ok"])

    def test_license_drift_fails(self):
        stored = make_record()
        fresh = {"license_name": "CC BY-NC 4.0", "mediatype": "BITMAP"}
        result = check_revalidation(stored, fresh)
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["reasons"]), 2)

    def test_mediatype_drift_fails(self):
        stored = make_record()
        fresh = {"license_name": "CC BY-SA 4.0", "mediatype": "VIDEO"}
        result = check_revalidation(stored, fresh)
        self.assertFalse(result["ok"])

    def test_missing_mediatype_fails_closed(self):
        stored = make_record()
        fresh = {"license_name": "CC BY-SA 4.0"}
        result = check_revalidation(stored, fresh)
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
