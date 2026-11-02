"""The static question catalog: build, publish, verify, and coexist with the sessions.

The catalog is published beside the sessions and read by no released client.
These tests fix its contract (identity, eligibility, integrity, atomicity) and
that publishing it changes nothing a released client reads.
"""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import quiz_catalog
from kpop_scraping.daily_puzzles_runner import NEXT_DIRNAME, _quiz_sessions, run_daily_puzzles
from kpop_scraping.quiz_catalog import (
    CATALOG_MANIFEST_FILENAME,
    CATALOG_MANIFEST_VERSION,
    CATALOG_SCHEMA_VERSION,
    POOL_KEYS,
    SHARD_KEYS,
    build_catalog,
    build_catalog_manifest,
    catalog_coverage,
    catalog_coverage_lines,
    catalog_version,
    publish_catalog,
    published_catalog_coverage_lines,
    read_catalog,
    remove_catalog,
    replay_status,
    shard_bytes,
    shard_path,
    validate_catalog_manifest,
    validate_catalog_shard,
    validate_sessions_in_catalog,
    verify_catalog,
)
from kpop_scraping.quiz_generator import generate_dataset
from kpop_scraping.quiz_models import QuizConfig
from kpop_scraping.quiz_schema import validate_session
from kpop_scraping.quiz_session import eligible_questions
from kpop_scraping.web_publish import (
    ENRICHED_MANIFEST_FILENAME,
    MANIFEST_FILENAME,
    main as web_publish_main,
    publish,
    verify,
)
from tests.test_daily_puzzles_runner import build_test_database
from tests.test_quiz_generator import build_quiz_database

SEED = "web-launch-v1"
DAY = "2026-10-12"


def _dataset(related_clues: bool = False, reverse: bool = False) -> dict:
    connection = build_quiz_database(reverse=reverse)
    try:
        dataset, _ = generate_dataset(connection, related_clues=related_clues)
    finally:
        connection.close()
    return dataset


def _rewrite(directory: Path, key: str, mutate) -> None:
    """Replace a published shard by a changed one and keep the manifest consistent.

    The hash in the manifest matches the new bytes, so only the deeper layers
    (schema, identity, language, pools) can notice the change.
    """
    manifest = json.loads((directory / CATALOG_MANIFEST_FILENAME).read_text(encoding="utf-8"))
    entry = manifest["shards"][key]
    shard = json.loads((directory / entry["path"]).read_text(encoding="utf-8"))
    mutate(shard)
    content = shard_bytes(shard)
    digest = hashlib.sha256(content).hexdigest()
    (directory / entry["path"]).unlink()
    entry["sha256"] = digest
    entry["path"] = shard_path(key, digest)
    entry["questions"] = len(shard["questions"])
    entry["pools"] = {name: len(indexes) for name, indexes in shard["pools"].items()}
    (directory / entry["path"]).write_bytes(content)
    manifest["catalog_version"] = catalog_version(
        manifest["dataset_version"], {k: e["sha256"] for k, e in manifest["shards"].items()}
    )
    (directory / CATALOG_MANIFEST_FILENAME).write_text(json.dumps(manifest), encoding="utf-8")


class CatalogBuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = _dataset()
        cls.shards = build_catalog(cls.dataset)

    def test_one_shard_for_every_language_and_mode(self):
        self.assertEqual(set(self.shards), set(SHARD_KEYS))
        for key, shard in self.shards.items():
            self.assertEqual(shard["schema_version"], CATALOG_SCHEMA_VERSION)
            self.assertEqual(f"{shard['language']}.{shard['play_mode']}", key)
            self.assertEqual(shard["dataset_version"], self.dataset["dataset_version"])
            for question in shard["questions"]:
                self.assertEqual((question["language"], question["play_mode"]), (shard["language"], shard["play_mode"]))

    def test_the_catalog_is_the_same_whatever_the_order_the_database_was_filled(self):
        other = build_catalog(_dataset(reverse=True))
        self.assertEqual(
            {key: shard_bytes(shard) for key, shard in other.items()},
            {key: shard_bytes(shard) for key, shard in self.shards.items()},
        )

    def test_pools_are_the_pools_the_sessions_draw_from(self):
        for key, shard in self.shards.items():
            for pool_key in POOL_KEYS:
                decade = None if pool_key == "all" else int(pool_key.split(".")[1])
                expected = {
                    question["id"]
                    for question in eligible_questions(
                        self.dataset,
                        QuizConfig(shard["language"], "any", play_mode=shard["play_mode"], decade=decade),
                    )
                }
                published = {shard["questions"][index]["id"] for index in shard["pools"][pool_key]}
                self.assertEqual(published, expected, f"{key} {pool_key}")

    def test_filters_follow_the_questions_decades(self):
        shard = self.shards["en.standard"]
        self.assertGreaterEqual(len(shard["pools"]["decade.2000"]), 10)
        for empty in ("decade.1990", "decade.2010", "decade.2020"):
            self.assertEqual(shard["pools"][empty], [])
        for index in shard["pools"]["decade.2000"]:
            self.assertIn(2000, shard["questions"][index]["decades"])

    def test_ids_and_semantic_ids_are_unique_inside_a_shard(self):
        for shard in self.shards.values():
            ids = [question["id"] for question in shard["questions"]]
            semantic = [question["semantic_id"] for question in shard["questions"]]
            self.assertEqual(len(set(ids)), len(ids))
            self.assertEqual(len(set(semantic)), len(semantic))

    def test_every_question_keeps_its_evidence(self):
        for shard in self.shards.values():
            for question in shard["questions"]:
                self.assertTrue(question["evidence"])
                self.assertEqual({item["fact_base_id"] for item in question["evidence"]}, set(question["fact_base_ids"]))

    def test_the_catalog_carries_the_questions_of_the_dataset_untouched(self):
        by_id = {question["id"]: question for question in self.dataset["questions"]}
        for shard in self.shards.values():
            for question in shard["questions"]:
                self.assertEqual(question, by_id[question["id"]])

    def test_the_group_relevance_threshold_shapes_assisted_and_expert_pools(self):
        dataset = copy.deepcopy(self.dataset)
        for question in dataset["questions"]:
            question["group_relevance_score"] = 9_000 if int(question["logical_id"][:2], 16) % 2 else 1_000
        shards = build_catalog(dataset)
        standard = shards["en.standard"]
        assisted = shards["en.assisted"]
        expert = shards["en.expert"]
        self.assertEqual(len(standard["pools"]["all"]), len(standard["questions"]))
        self.assertGreaterEqual(len(assisted["pools"]["all"]), 10)
        self.assertLess(len(assisted["pools"]["all"]), len(standard["pools"]["all"]))
        self.assertTrue(all(assisted["questions"][i]["group_relevance_score"] >= 6_667 for i in assisted["pools"]["all"]))
        self.assertTrue(all(expert["questions"][i]["group_relevance_score"] <= 3_333 for i in expert["pools"]["all"]))

    def test_a_dataset_without_both_languages_has_no_catalog(self):
        connection = build_quiz_database()
        try:
            dataset, _ = generate_dataset(connection, languages=("en",))
        finally:
            connection.close()
        with self.assertRaisesRegex(ValueError, "pt-BR and en"):
            build_catalog(dataset)

    def test_replay_status_follows_the_ten_question_rule(self):
        self.assertEqual(replay_status(11), "ok")
        self.assertEqual(replay_status(10), "repeats")
        self.assertEqual(replay_status(9), "unavailable")
        self.assertEqual(replay_status(0), "unavailable")

    def test_coverage_counts_what_the_pools_offer(self):
        coverage = catalog_coverage(self.shards)
        item = coverage["en.standard"]
        self.assertEqual(item["questions"], len(self.shards["en.standard"]["questions"]))
        self.assertEqual(item["pools"]["all"]["eligible"], 84)
        self.assertEqual(item["pools"]["all"]["replay"], "ok")
        self.assertEqual(item["pools"]["decade.1990"], {"eligible": 0, "replay": "unavailable"})
        self.assertEqual(sum(item["by_type"].values()), item["questions"])
        self.assertEqual(coverage["en.expert"]["with_clue"], 0)


class CatalogManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = _dataset()
        cls.shards = build_catalog(cls.dataset)
        cls.manifest = build_catalog_manifest(cls.shards)

    def test_the_manifest_names_every_shard_by_hash_with_its_eligible_counts(self):
        validate_catalog_manifest(self.manifest)
        self.assertEqual(self.manifest["schema_version"], CATALOG_MANIFEST_VERSION)
        for key, entry in self.manifest["shards"].items():
            shard = self.shards[key]
            self.assertEqual(entry["sha256"], hashlib.sha256(shard_bytes(shard)).hexdigest())
            self.assertEqual(entry["path"], f"catalog.{key}.{entry['sha256']}.json")
            self.assertEqual(entry["questions"], len(shard["questions"]))
            self.assertEqual(entry["pools"], {k: len(v) for k, v in shard["pools"].items()})

    def test_catalog_version_is_the_hash_of_dataset_and_shard_hashes(self):
        lines = [CATALOG_MANIFEST_VERSION, self.manifest["dataset_version"]]
        lines += [f"{key}:{self.manifest['shards'][key]['sha256']}" for key in sorted(self.manifest["shards"])]
        expected = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
        self.assertEqual(self.manifest["catalog_version"], expected)

    def test_content_changes_move_the_version_and_keep_the_dataset(self):
        changed = copy.deepcopy(self.shards)
        changed["en.standard"]["questions"][0]["explanation"] += " (changed)"
        other = build_catalog_manifest(changed)
        self.assertEqual(other["dataset_version"], self.manifest["dataset_version"])
        self.assertNotEqual(other["catalog_version"], self.manifest["catalog_version"])
        self.assertNotEqual(other["shards"]["en.standard"]["sha256"], self.manifest["shards"]["en.standard"]["sha256"])

    def test_related_clues_change_the_catalog_version_not_the_dataset_version(self):
        enriched = build_catalog_manifest(build_catalog(_dataset(related_clues=True)))
        self.assertEqual(enriched["dataset_version"], self.manifest["dataset_version"])
        self.assertNotEqual(enriched["catalog_version"], self.manifest["catalog_version"])

    def test_the_manifest_refuses_an_incomplete_or_mixed_catalog(self):
        partial = {key: shard for key, shard in self.shards.items() if key != "en.expert"}
        with self.assertRaisesRegex(ValueError, "every language and play mode"):
            build_catalog_manifest(partial)
        mixed = dict(self.shards)
        mixed["en.expert"] = {**self.shards["en.expert"], "dataset_version": "f" * 64}
        with self.assertRaisesRegex(ValueError, "one dataset"):
            build_catalog_manifest(mixed)

    def test_the_manifest_refuses_a_shard_filed_under_another_key(self):
        swapped = dict(self.shards)
        swapped["en.standard"], swapped["pt-BR.standard"] = swapped["pt-BR.standard"], swapped["en.standard"]
        with self.assertRaisesRegex(ValueError, "catalog shard key"):
            build_catalog_manifest(swapped)

    def test_manifest_schema_fields_and_paths_are_exact(self):
        cases = {
            "schema_version": lambda m: m.update(schema_version="kpop-quiz-catalog-manifest-v0"),
            "extra field": lambda m: m.update(extra=1),
            "dataset_version": lambda m: m.update(dataset_version="zz"),
            "catalog_version": lambda m: m.update(catalog_version="0" * 64),
            "date": lambda m: m.update(reference_date="2026-13-01"),
            "missing shard": lambda m: m["shards"].pop("en.expert"),
            "path": lambda m: m["shards"]["en.expert"].update(path="../catalog.en.expert.json"),
            "pool counts": lambda m: m["shards"]["en.expert"]["pools"].pop("decade.2000"),
            "pool above questions": lambda m: m["shards"]["en.expert"]["pools"].update(all=10**6),
            "shard field": lambda m: m["shards"]["en.expert"].update(extra=1),
        }
        for name, mutate in cases.items():
            with self.subTest(name):
                broken = copy.deepcopy(self.manifest)
                mutate(broken)
                with self.assertRaises(ValueError):
                    validate_catalog_manifest(broken)


class CatalogShardValidationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shards = build_catalog(_dataset(related_clues=True))

    def broken(self, key="en.assisted"):
        return copy.deepcopy(self.shards[key])

    def assertRejected(self, shard):
        with self.assertRaises(ValueError):
            validate_catalog_shard(shard)

    def test_a_published_shard_is_valid_even_with_related_clues(self):
        for shard in self.shards.values():
            validate_catalog_shard(shard)
        self.assertTrue(any(q["clues_available"] for q in self.shards["en.assisted"]["questions"]))

    def test_identity_language_and_mode(self):
        for name, mutate in {
            "schema": lambda s: s.update(schema_version="kpop-quiz-catalog-v0"),
            "extra field": lambda s: s.update(extra=1),
            "missing field": lambda s: s.pop("template_version"),
            "dataset_version": lambda s: s.update(dataset_version="abc"),
            "language": lambda s: s.update(language="pt-BR"),
            "unknown language": lambda s: s.update(language="fr"),
            "mode": lambda s: s.update(play_mode="expert"),
            "reference date": lambda s: s.update(reference_date="2020-01-01"),
        }.items():
            with self.subTest(name):
                shard = self.broken()
                mutate(shard)
                self.assertRejected(shard)

    def test_questions(self):
        def drop_evidence(shard):
            shard["questions"][0]["evidence"] = []

        def duplicate_id(shard):
            shard["questions"][1]["id"] = shard["questions"][0]["id"]

        def duplicate_semantic(shard):
            shard["questions"][1]["semantic_id"] = shard["questions"][0]["semantic_id"]

        def other_language(shard):
            shard["questions"][0]["language"] = "pt-BR"

        def other_mode(shard):
            shard["questions"][0]["play_mode"] = "standard"

        def wrong_answer(shard):
            shard["questions"][0]["answer_option_id"] = "0" * 64

        def reorder(shard):
            shard["questions"].reverse()
            shard["pools"] = {key: [] for key in shard["pools"]}
            shard["pools"]["all"] = list(range(len(shard["questions"])))

        def expert_clue(shard):
            expert = self.shards["en.assisted"]["questions"]
            shard["questions"][0]["clues_available"] = next(q["clues_available"] for q in expert if q["clues_available"])

        for name, mutate in {
            "no evidence": drop_evidence,
            "duplicate id": duplicate_id,
            "duplicate semantic id": duplicate_semantic,
            "question language": other_language,
            "question mode": other_mode,
            "answer outside options": wrong_answer,
            "order": reorder,
            "no questions": lambda s: s.update(questions=[], pools={key: [] for key in s["pools"]}),
        }.items():
            with self.subTest(name):
                shard = self.broken()
                mutate(shard)
                self.assertRejected(shard)
        expert = self.broken("en.expert")
        expert_clue(expert)
        self.assertRejected(expert)

    def test_pools(self):
        def out_of_range(shard):
            shard["pools"]["all"].append(len(shard["questions"]))

        def negative(shard):
            shard["pools"]["all"][0] = -1

        def unsorted(shard):
            shard["pools"]["all"][0], shard["pools"]["all"][1] = shard["pools"]["all"][1], shard["pools"]["all"][0]

        def repeated(shard):
            shard["pools"]["all"][1] = shard["pools"]["all"][0]

        def wrong_decade(shard):
            shard["pools"]["decade.1990"] = [0]

        def unreferenced(shard):
            shard["pools"]["all"].pop()
            shard["pools"]["decade.2000"].pop()

        for name, mutate in {
            "index out of range": out_of_range,
            "negative index": negative,
            "unsorted": unsorted,
            "repeated index": repeated,
            "question without that decade": wrong_decade,
            "question outside every pool": unreferenced,
            "missing pool": lambda s: s["pools"].pop("decade.2010"),
            "extra pool": lambda s: s["pools"].update({"theme.history": [0]}),
            "empty all": lambda s: s["pools"].update(all=[]),
            "non integer": lambda s: s["pools"]["all"].__setitem__(0, "0"),
        }.items():
            with self.subTest(name):
                shard = self.broken()
                mutate(shard)
                self.assertRejected(shard)


class CatalogPublicationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shards = build_catalog(_dataset())

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out = Path(self._tmp.name) / "data"

    def files(self):
        return {path.name: path.read_bytes() for path in sorted(self.out.iterdir())}

    def test_publishes_shards_then_manifest_and_verifies(self):
        manifest = publish_catalog(self.out, self.shards)
        self.assertEqual(
            set(self.files()),
            {CATALOG_MANIFEST_FILENAME, *(entry["path"] for entry in manifest["shards"].values())},
        )
        self.assertTrue(verify_catalog(self.out, required=True))
        read_manifest, read_shards = read_catalog(self.out)
        self.assertEqual(read_manifest, manifest)
        self.assertEqual(read_shards, self.shards)

    def test_publishing_twice_leaves_the_same_bytes(self):
        publish_catalog(self.out, self.shards)
        before = self.files()
        publish_catalog(self.out, self.shards)
        self.assertEqual(self.files(), before)

    def test_a_newer_catalog_replaces_the_previous_generation(self):
        publish_catalog(self.out, self.shards)
        first = set(self.files())
        newer = copy.deepcopy(self.shards)
        for shard in newer.values():
            shard["dataset_version"] = "a" * 64
        publish_catalog(self.out, newer)
        second = set(self.files())
        self.assertEqual(len(second), 7)
        self.assertEqual(first & second, {CATALOG_MANIFEST_FILENAME})
        verify_catalog(self.out, required=True)

    def test_an_interrupted_publication_keeps_the_previous_catalog_whole(self):
        publish_catalog(self.out, self.shards)
        before = self.files()
        newer = copy.deepcopy(self.shards)
        for shard in newer.values():
            shard["questions"][0]["explanation"] += " (newer)"
        real = quiz_catalog.write_json_atomic
        for failing_call in (1, 3, 7):
            calls = []

            def flaky(path, payload, validator, _real=real, _calls=calls, _failing=failing_call):
                _calls.append(path.name)
                if len(_calls) == _failing:
                    raise OSError("disk full")
                return _real(path, payload, validator)

            with self.subTest(failing_call=failing_call), patch.object(quiz_catalog, "write_json_atomic", flaky):
                with self.assertRaises(OSError):
                    publish_catalog(self.out, newer)
                self.assertTrue(set(before) <= set(self.files()))
                for name, content in before.items():
                    self.assertEqual((self.out / name).read_bytes(), content)
                verify_catalog(self.out, required=True)

    def test_an_invalid_shard_publishes_nothing(self):
        bad = copy.deepcopy(self.shards)
        bad["en.standard"]["pools"]["all"] = []
        with self.assertRaises(ValueError):
            publish_catalog(self.out, bad)
        self.assertFalse(self.out.exists())

    def test_remove_withdraws_manifest_and_shards_only(self):
        publish_catalog(self.out, self.shards)
        (self.out / "session.keep.json").write_text("{}", encoding="utf-8")
        self.assertTrue(remove_catalog(self.out))
        self.assertEqual(set(self.files()), {"session.keep.json"})
        self.assertFalse(remove_catalog(self.out))

    def test_an_absent_catalog_is_optional_unless_required(self):
        self.out.mkdir()
        self.assertFalse(verify_catalog(self.out))
        with self.assertRaisesRegex(ValueError, "missing required catalog"):
            verify_catalog(self.out, required=True)
        self.assertEqual(published_catalog_coverage_lines(self.out, "Quiz catalog"), ["Quiz catalog: not published"])

    def test_orphan_shards_do_not_count_as_a_catalog(self):
        publish_catalog(self.out, self.shards)
        (self.out / f"catalog.en.standard.{'0' * 64}.json").write_text("not json", encoding="utf-8")
        verify_catalog(self.out, required=True)
        publish_catalog(self.out, self.shards)
        self.assertEqual(len(self.files()), 7)


class CatalogCorruptionTest(unittest.TestCase):
    """Every layer between the publisher and a reader notices a bad artifact."""

    @classmethod
    def setUpClass(cls):
        cls.shards = build_catalog(_dataset())

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out = Path(self._tmp.name) / "data"
        self.manifest = publish_catalog(self.out, self.shards)
        self.shard_file = self.out / self.manifest["shards"]["en.standard"]["path"]

    def assertBroken(self, message=None):
        with self.assertRaisesRegex(ValueError, message or ".") as caught:
            verify_catalog(self.out, required=True)
        return caught.exception

    def test_a_changed_byte_is_a_hash_mismatch(self):
        content = bytearray(self.shard_file.read_bytes())
        content[len(content) // 2] ^= 0x01
        self.shard_file.write_bytes(bytes(content))
        self.assertBroken("hash")

    def test_a_truncated_shard_is_a_hash_mismatch(self):
        content = self.shard_file.read_bytes()
        self.shard_file.write_bytes(content[: len(content) // 2])
        self.assertBroken("hash")

    def test_an_emptied_shard_is_a_hash_mismatch(self):
        self.shard_file.write_bytes(b"")
        self.assertBroken("hash")

    def test_a_missing_shard(self):
        self.shard_file.unlink()
        self.assertBroken("cannot read catalog shard")

    def test_a_truncated_manifest(self):
        path = self.out / CATALOG_MANIFEST_FILENAME
        path.write_bytes(path.read_bytes()[:40])
        self.assertBroken("cannot read catalog manifest")

    def test_a_shard_that_is_not_json_even_with_a_matching_hash(self):
        junk = b"not json\n"
        digest = hashlib.sha256(junk).hexdigest()
        manifest = json.loads((self.out / CATALOG_MANIFEST_FILENAME).read_text())
        entry = manifest["shards"]["en.standard"]
        entry.update(sha256=digest, path=shard_path("en.standard", digest))
        manifest["catalog_version"] = catalog_version(
            manifest["dataset_version"], {k: e["sha256"] for k, e in manifest["shards"].items()}
        )
        (self.out / entry["path"]).write_bytes(junk)
        (self.out / CATALOG_MANIFEST_FILENAME).write_text(json.dumps(manifest))
        self.assertBroken("cannot parse catalog shard")

    def test_a_shard_changed_with_a_consistent_manifest_still_fails_the_schema(self):
        _rewrite(self.out, "en.standard", lambda s: s["questions"][0].update(evidence=[]))
        self.assertBroken("evidence")

    def test_a_shard_of_another_language_filed_under_this_key(self):
        manifest = json.loads((self.out / CATALOG_MANIFEST_FILENAME).read_text())
        other = manifest["shards"]["pt-BR.standard"]
        content = (self.out / other["path"]).read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        entry = manifest["shards"]["en.standard"]
        entry.update(sha256=digest, path=shard_path("en.standard", digest))
        (self.out / entry["path"]).write_bytes(content)
        manifest["catalog_version"] = catalog_version(
            manifest["dataset_version"], {k: e["sha256"] for k, e in manifest["shards"].items()}
        )
        (self.out / CATALOG_MANIFEST_FILENAME).write_text(json.dumps(manifest))
        self.assertBroken("catalog shard key|manifest")

    def test_a_shard_of_another_dataset_version(self):
        _rewrite(self.out, "en.standard", lambda s: s.update(dataset_version="b" * 64))
        self.assertBroken("one dataset|manifest")

    def test_a_shard_with_a_pool_edited_to_include_a_question_of_another_decade(self):
        _rewrite(self.out, "en.standard", lambda s: s["pools"].update({"decade.1990": [0]}))
        self.assertBroken("decade")

    def test_a_changed_manifest_count(self):
        path = self.out / CATALOG_MANIFEST_FILENAME
        manifest = json.loads(path.read_text())
        manifest["shards"]["en.standard"]["pools"]["all"] -= 1
        path.write_text(json.dumps(manifest))
        self.assertBroken("manifest")

    def test_a_manifest_that_names_another_catalog_version(self):
        path = self.out / CATALOG_MANIFEST_FILENAME
        manifest = json.loads(path.read_text())
        manifest["catalog_version"] = "0" * 64
        path.write_text(json.dumps(manifest))
        self.assertBroken("catalog_version")

    def test_a_shard_read_never_returns_partial_content(self):
        content = bytearray(self.shard_file.read_bytes())
        content[10] ^= 0x01
        self.shard_file.write_bytes(bytes(content))
        with self.assertRaises(ValueError):
            read_catalog(self.out)


class CatalogAndSessionsTest(unittest.TestCase):
    """The catalog never changes what a released client reads."""

    @classmethod
    def setUpClass(cls):
        cls.legacy = _quiz_sessions(_dataset(), DAY, SEED, None)
        cls.enriched = _quiz_sessions(_dataset(related_clues=True), DAY, SEED, None)
        cls.shards = build_catalog(_dataset())
        cls.enriched_shards = build_catalog(_dataset(related_clues=True))

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def test_every_published_session_question_is_a_catalog_pool_question(self):
        validate_sessions_in_catalog(self.legacy, self.shards)

    def test_legacy_sessions_agree_with_an_enriched_catalog(self):
        validate_sessions_in_catalog(self.legacy, self.enriched_shards)

    def test_a_session_question_changed_in_the_catalog_is_refused(self):
        changed = copy.deepcopy(self.shards)
        target = self.legacy["en.standard"]["questions"][0]["id"]
        next(q for q in changed["en.standard"]["questions"] if q["id"] == target)["prompt"] += " ?"
        with self.assertRaisesRegex(ValueError, "differs from the catalog"):
            validate_sessions_in_catalog({"en.standard": self.legacy["en.standard"]}, changed)

    def test_a_session_question_outside_the_pool_is_refused(self):
        shards = copy.deepcopy(self.shards)
        shard = shards["en.standard"]
        target = self.legacy["en.standard"]["questions"][0]["id"]
        index = next(i for i, q in enumerate(shard["questions"]) if q["id"] == target)
        for key, pool in shard["pools"].items():
            shard["pools"][key] = [i for i in pool if i != index]
        with self.assertRaisesRegex(ValueError, "outside the catalog pool"):
            validate_sessions_in_catalog({"en.standard": self.legacy["en.standard"]}, shards)

    def test_a_legacy_clue_changed_in_the_catalog_is_refused(self):
        key = next(k for k, s in self.legacy.items() if any(q["clues_available"] for q in s["questions"]))
        session = self.legacy[key]
        question = next(q for q in session["questions"] if q["clues_available"])
        shards = copy.deepcopy(self.shards)
        shard = shards[f"{session['config']['language']}.{session['config']['play_mode']}"]
        published = next(q for q in shard["questions"] if q["id"] == question["id"])
        published["clues_available"][0]["text"] += " (changed)"
        with self.assertRaisesRegex(ValueError, "clue differs"):
            validate_sessions_in_catalog({key: session}, shards)

    def test_publishing_the_catalog_leaves_every_session_byte_untouched(self):
        plain, with_catalog = self.root / "plain", self.root / "with"
        publish(plain, self.legacy, enriched_sessions=self.enriched)
        publish(with_catalog, self.legacy, enriched_sessions=self.enriched)
        publish_catalog(with_catalog, self.enriched_shards)
        files = {p.name: p.read_bytes() for p in plain.iterdir()}
        kept = {p.name: p.read_bytes() for p in with_catalog.iterdir() if not p.name.startswith("catalog")}
        self.assertEqual(kept, files)
        verify(with_catalog, require_catalog=True)

    def test_released_clients_find_the_manifest_shapes_they_validate(self):
        publish(self.root / "d", self.legacy, enriched_sessions=self.enriched)
        publish_catalog(self.root / "d", self.enriched_shards)
        for name in (MANIFEST_FILENAME, ENRICHED_MANIFEST_FILENAME):
            manifest = json.loads((self.root / "d" / name).read_text())
            self.assertEqual(set(manifest), {"dataset_version", "schema_version", "sessions"})
            self.assertTrue(all(set(e) == {"path", "session_id", "sha256"} for e in manifest["sessions"].values()))
            self.assertFalse(any("catalog" in e["path"] for e in manifest["sessions"].values()))

    def test_verify_checks_the_sessions_against_a_catalog_of_the_same_dataset(self):
        out = self.root / "out"
        publish(out, self.legacy)
        publish_catalog(out, self.shards)
        verify(out, require_catalog=True)
        # A catalog that lost a session question breaks the cross-check.
        target = self.legacy["en.standard"]["questions"][0]["id"]

        def drop(shard):
            index = next(i for i, q in enumerate(shard["questions"]) if q["id"] == target)
            shard["pools"] = {
                key: [i - (i > index) for i in pool if i != index] for key, pool in shard["pools"].items()
            }
            del shard["questions"][index]

        _rewrite(out, "en.standard", drop)
        with self.assertRaisesRegex(ValueError, "outside the catalog pool"):
            verify(out)

    def test_verify_does_not_compare_sessions_with_a_catalog_of_another_dataset(self):
        out = self.root / "out"
        publish(out, self.legacy)
        other = copy.deepcopy(self.shards)
        for shard in other.values():
            shard["dataset_version"] = "c" * 64
        publish_catalog(out, other)
        verify(out, require_catalog=True)

    def test_verify_reports_a_corrupted_catalog_even_when_sessions_are_fine(self):
        out = self.root / "out"
        publish(out, self.legacy)
        manifest = publish_catalog(out, self.shards)
        (out / manifest["shards"]["pt-BR.expert"]["path"]).write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "hash"):
            verify(out)

    def test_the_command_line_requires_and_reports_the_catalog(self):
        out = self.root / "out"
        publish(out, self.legacy)
        self.assertEqual(web_publish_main(["--output-dir", str(out), "--verify"]), 0)
        self.assertEqual(web_publish_main(["--output-dir", str(out), "--verify", "--require-catalog"]), 1)
        publish_catalog(out, self.shards)
        self.assertEqual(web_publish_main(["--output-dir", str(out), "--verify", "--require-catalog"]), 0)
        self.assertEqual(web_publish_main(["--output-dir", str(out), "--require-catalog"]), 1)
        self.assertEqual(web_publish_main(["--output-dir", str(out), "--catalog", "--verify"]), 1)


class DailyRunCatalogTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.db = self.root / "kpop.db"
        build_test_database(self.db).close()
        self.quiz_connection = build_quiz_database()
        self.addCleanup(self.quiz_connection.close)
        patcher = patch(
            "kpop_scraping.daily_puzzles_runner.generate_dataset",
            side_effect=lambda connection, **kwargs: generate_dataset(self.quiz_connection, **kwargs),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_day(self, out: Path, day: str = DAY, **kwargs):
        return run_daily_puzzles(self.db, out, reference_date=day, **kwargs)

    @staticmethod
    def files(directory: Path, catalog: bool) -> dict[str, bytes]:
        return {
            path.name: path.read_bytes()
            for path in sorted(directory.glob("*.json"))
            if path.name.startswith("catalog") == catalog
        }

    def test_without_the_flag_nothing_changes_and_nothing_is_published(self):
        out = self.root / "out"
        result = self.run_day(out, ahead=True)
        self.assertIsNone(result["catalog"])
        self.assertEqual(self.files(out, catalog=True), {})
        self.assertEqual(self.files(out / NEXT_DIRNAME, catalog=True), {})

    def test_the_flag_adds_the_catalog_and_changes_no_other_file(self):
        off, on = self.root / "off", self.root / "on"
        self.run_day(off, ahead=True)
        result = self.run_day(on, ahead=True, catalog=True)
        self.assertEqual(self.files(on, catalog=False), self.files(off, catalog=False))
        self.assertEqual(self.files(on / NEXT_DIRNAME, catalog=False), self.files(off / NEXT_DIRNAME, catalog=False))
        self.assertEqual(len(self.files(on, catalog=True)), 7)
        self.assertEqual(self.files(on / NEXT_DIRNAME, catalog=True), {}, "the catalog lives in the main directory only")
        verify_catalog(on, required=True)
        manifest, _ = read_catalog(on)
        self.assertEqual(result["catalog"]["catalog_version"], manifest["catalog_version"])
        self.assertTrue(any("en.standard: all 84 (ok)" in line for line in result["catalog"]["lines"]))

    def test_the_catalog_follows_the_run_not_the_kept_day(self):
        out = self.root / "out"
        self.run_day(out)
        before = self.files(out, catalog=False)
        result = self.run_day(out, catalog=True)
        self.assertTrue(result["already_published"])
        self.assertEqual(self.files(out, catalog=False), before)
        verify_catalog(out, required=True)

    def test_promoting_the_next_day_keeps_the_catalog(self):
        out = self.root / "out"
        self.run_day(out, ahead=True, catalog=True)
        catalog = self.files(out, catalog=True)
        result = self.run_day(out, "2026-10-13", catalog=True)
        self.assertTrue(result["promoted_from_next"])
        self.assertEqual(self.files(out, catalog=True), catalog)
        verify(out, require_catalog=True)

    def test_turning_the_flag_off_withdraws_the_catalog_and_keeps_the_day(self):
        out = self.root / "out"
        self.run_day(out, catalog=True)
        sessions = self.files(out, catalog=False)
        result = self.run_day(out)
        self.assertEqual(result["catalog"], {"withdrawn": True})
        self.assertEqual(self.files(out, catalog=True), {})
        self.assertEqual(self.files(out, catalog=False), sessions)
        verify(out)

    def test_a_dry_run_reports_the_catalog_without_writing_it(self):
        out = self.root / "out"
        result = self.run_day(out, catalog=True, dry_run=True)
        self.assertTrue(result["catalog"]["dry_run"])
        self.assertFalse(out.exists())

    def test_related_clues_reach_the_catalog_with_the_flag_that_publishes_them(self):
        legacy, enriched = self.root / "legacy", self.root / "enriched"
        self.run_day(legacy, catalog=True)
        self.run_day(enriched, catalog=True, related_clues=True)
        _, legacy_shards = read_catalog(legacy)
        _, enriched_shards = read_catalog(enriched)

        def clued(shards):
            return sum(bool(q["clues_available"]) for q in shards["en.standard"]["questions"])

        self.assertGreater(clued(enriched_shards), clued(legacy_shards))
        self.assertTrue((enriched / ENRICHED_MANIFEST_FILENAME).is_file())
        verify(enriched, require_catalog=True)

    def test_an_invalid_catalog_fails_the_run_instead_of_publishing_it(self):
        out = self.root / "out"
        with patch(
            "kpop_scraping.daily_puzzles_runner.build_catalog", side_effect=ValueError("catalog invalid")
        ), self.assertRaisesRegex(ValueError, "catalog invalid"):
            self.run_day(out, catalog=True)
        self.assertEqual(self.files(out, catalog=True), {})

    def test_a_published_catalog_verifies_through_the_runner(self):
        out = self.root / "out"
        self.run_day(out, ahead=True, catalog=True)
        self.assertEqual(run_daily_puzzles(output_dir=out, verify_only=True)["status"], "verified")
        lines = published_catalog_coverage_lines(out, "Quiz catalog")
        self.assertIn("6 shards", lines[0])
        self.assertTrue(any("pt-BR.standard" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
