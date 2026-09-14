import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from kpop_scraping.quiz_generator import (
    InsufficientQuestionsError,
    QuizConfig,
    create_session,
    generate_dataset,
)
from kpop_scraping.quiz_cli import main as quiz_main
from kpop_scraping.quiz_schema import validate_dataset, write_json_atomic


class QuizGeneratorTest(unittest.TestCase):
    def setUp(self):
        self.connection = build_quiz_database()

    def tearDown(self):
        self.connection.close()

    def test_generates_supported_types_with_four_distinct_typed_options(self):
        dataset, report = generate_dataset(self.connection, date(2026, 9, 13))
        self.assertEqual(
            {question["type"] for question in dataset["questions"]},
            {
                "formation_year",
                "member_at_date",
                "birth_date_or_place",
                "age_on_date",
                "group_for_member",
                "member_for_group",
                "group_for_record_label",
                "record_label_for_group",
                "chronological_comparison",
            },
        )
        self.assertEqual(report["accepted_logical"], dataset["logical_question_count"])
        self.assertEqual(report["language_variants"], 2 * report["accepted_logical"])
        self.assertEqual(report["accepted_by_template"], report["accepted_by_type"])
        self.assertEqual(
            sum(report["accepted_by_predicate"].values()),
            report["accepted_logical"],
        )
        for question in dataset["questions"]:
            self.assertEqual(len(question["options"]), 4)
            self.assertEqual(len({item["id"] for item in question["options"]}), 4)
            self.assertEqual(len({item["label"] for item in question["options"]}), 4)
            kinds = {item["value_type"] for item in question["options"]}
            self.assertEqual(len(kinds), 1)
            self.assertIn(question["answer_option_id"], {item["id"] for item in question["options"]})
            self.assertTrue(question["evidence"])
            self.assertEqual(
                {item["fact_base_id"] for item in question["evidence"]},
                set(question["fact_base_ids"]),
            )
            self.assertTrue(all(item["source_url"].startswith("https://") for item in question["evidence"]))

    def test_people_and_groups_use_one_canonical_name_in_both_languages(self):
        group_id = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='QG1'"
        ).fetchone()[0]
        person_id = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='QP1'"
        ).fetchone()[0]
        self.connection.executemany(
            "INSERT INTO entity_aliases(entity_id, language, name, alias_type) VALUES (?, ?, ?, 'label')",
            [
                (group_id, "pt", "Nome antigo do grupo"),
                (group_id, "en", "Current group name"),
                (person_id, "pt", "Romanização A"),
                (person_id, "en", "Romanization B"),
            ],
        )
        self.connection.commit()

        dataset, _report = generate_dataset(self.connection)
        labels: dict[tuple[str, str], str] = {}
        for question in dataset["questions"]:
            for option in question["options"]:
                if option["value"] in {"QG1", "QP1"}:
                    labels[(question["language"], option["value"])] = option["label"]
        self.assertEqual(labels[("pt-BR", "QG1")], labels[("en", "QG1")])
        self.assertEqual(labels[("pt-BR", "QP1")], labels[("en", "QP1")])

    def test_editorial_copy_exposes_comparison_values_without_pipeline_language(self):
        dataset, _report = generate_dataset(self.connection)
        forbidden = ("afirmação citada", "cited statement")
        for question in dataset["questions"]:
            copy = f"{question['prompt']} {question['explanation']}".lower()
            self.assertTrue(all(phrase not in copy for phrase in forbidden))
            if question["type"] == "chronological_comparison":
                for option in question["options"]:
                    self.assertIn(option["label"], question["explanation"])
                self.assertEqual(question["explanation"].count("("), 4)

    def test_full_dates_are_localized_in_prose(self):
        dataset, _report = generate_dataset(self.connection)
        age_questions = [
            question for question in dataset["questions"]
            if question["type"] == "age_on_date"
        ]
        self.assertTrue(any("13 de setembro de 2026" in q["prompt"] for q in age_questions))
        self.assertTrue(any("13 September 2026" in q["prompt"] for q in age_questions))

    def test_relation_distractors_are_not_other_valid_answers(self):
        dataset, _report = generate_dataset(self.connection)
        member_ids_by_group = {
            f"QG{index}": {f"QP{index}"} for index in range(1, 8)
        }
        for question in dataset["questions"]:
            if question["language"] != "en":
                continue
            if question["type"] == "member_for_group":
                group_id = question["group_ids"][0]
                answer = next(
                    item["value"] for item in question["options"]
                    if item["id"] == question["answer_option_id"]
                )
                distractors = {
                    item["value"] for item in question["options"]
                    if item["value"] != answer
                }
                self.assertTrue(distractors.isdisjoint(member_ids_by_group[group_id]))

    def test_group_distractors_are_not_another_accepted_group_for_person(self):
        person = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='QP1'"
        ).fetchone()[0]
        group = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='QG2'"
        ).fetchone()[0]
        self.connection.execute(
            "UPDATE facts SET value_entity_id=?, value_wikidata_id='QP1' "
            "WHERE statement_id='has-2'",
            (person,),
        )
        self.connection.execute(
            "UPDATE facts SET subject_entity_id=?, value_entity_id=?, "
            "value_wikidata_id='QG2' WHERE statement_id='member-2'",
            (person, group),
        )
        self.connection.commit()

        dataset, _report = generate_dataset(self.connection)
        valid_groups = {"QG1", "QG2"}
        questions = [
            question
            for question in dataset["questions"]
            if question["language"] == "en"
            and question["type"] == "group_for_member"
            and "Person 1" in question["prompt"]
        ]
        self.assertEqual(len(questions), 2)
        for question in questions:
            option_values = {option["value"] for option in question["options"]}
            self.assertEqual(len(option_values & valid_groups), 1)

    def test_member_at_date_distractors_exclude_other_current_members(self):
        person = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='QP2'"
        ).fetchone()[0]
        group = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='QG1'"
        ).fetchone()[0]
        self.connection.execute(
            "UPDATE facts SET subject_entity_id=?, value_entity_id=?, "
            "value_wikidata_id='QP2', valid_from='2010-01-01', "
            "valid_from_precision=11, valid_to='2020-01-01', "
            "valid_to_precision=11, quality_flags_json='[]' "
            "WHERE statement_id='has-2'",
            (group, person),
        )
        self.connection.execute(
            "UPDATE facts SET subject_entity_id=?, value_entity_id=?, "
            "value_wikidata_id='QG1', valid_from='2010-01-01', "
            "valid_from_precision=11, valid_to='2020-01-01', "
            "valid_to_precision=11, quality_flags_json='[]' "
            "WHERE statement_id='member-2'",
            (person, group),
        )
        self.connection.commit()

        dataset, _report = generate_dataset(self.connection)
        for question in dataset["questions"]:
            if question["type"] != "member_at_date":
                continue
            option_values = {option["value"] for option in question["options"]}
            self.assertEqual(len(option_values & {"QP1", "QP2"}), 1)

    def test_insufficient_relation_pool_is_reported(self):
        self.connection.execute(
            "UPDATE facts SET status='rejected', status_reason='test_pool' "
            "WHERE predicate='has_member' AND statement_id NOT IN ('has-1', 'has-2', 'has-3')"
        )
        self.connection.commit()
        _dataset, report = generate_dataset(self.connection)
        self.assertEqual(report["accepted_by_type"]["member_for_group"], 0)
        self.assertEqual(report["rejected_by_reason"]["insufficient_nonmember_distractors"], 3)

    def test_output_is_canonical_and_independent_of_database_row_ids(self):
        first, first_report = generate_dataset(self.connection)
        reordered_languages, reordered_report = generate_dataset(
            self.connection, languages=("en", "pt-BR")
        )
        self.assertEqual(first, reordered_languages)
        self.assertEqual(first_report, reordered_report)
        other = build_quiz_database(reverse=True)
        try:
            second, second_report = generate_dataset(other)
        finally:
            other.close()
        self.assertEqual(first, second)
        self.assertEqual(first_report, second_report)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "questions.json"
            first_bytes = write_json_atomic(path, first, validate_dataset)
            second_bytes = write_json_atomic(path, second, validate_dataset)
            self.assertEqual(first_bytes, second_bytes)
            self.assertEqual(path.read_bytes(), first_bytes)

    def test_dataset_version_changes_when_a_fact_moves_to_another_subject(self):
        first, _report = generate_dataset(self.connection)
        moved = build_quiz_database()
        try:
            new_subject = moved.execute(
                "SELECT id FROM entities WHERE wikidata_id='QGR'"
            ).fetchone()[0]
            moved.execute(
                "UPDATE facts SET subject_entity_id=? WHERE statement_id='formation-1'",
                (new_subject,),
            )
            moved.commit()
            second, _report = generate_dataset(moved)
        finally:
            moved.close()
        self.assertNotEqual(first["dataset_version"], second["dataset_version"])

    def test_validation_runs_before_replacing_the_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            with self.assertRaisesRegex(ValueError, "schema_version"):
                write_json_atomic(path, {}, validate_dataset)
            self.assertFalse(path.exists())

    def test_session_is_deterministic_and_persists_filters_and_timer(self):
        dataset, _report = generate_dataset(self.connection)
        config = QuizConfig(
            language="pt-BR",
            seed="mesma-semente",
            timer_seconds=25,
        )
        first = create_session(dataset, config)
        second = create_session(dataset, config)
        self.assertEqual(first, second)
        self.assertEqual(len(first["questions"]), 10)
        self.assertEqual(first["config"]["timer_seconds"], 25)
        self.assertTrue(all(question["language"] == "pt-BR" for question in first["questions"]))
        self.assertEqual(len({question["semantic_id"] for question in first["questions"]}), 10)
        easy = create_session(
            dataset,
            QuizConfig(language="en", seed="easy", difficulty="easy"),
        )
        self.assertTrue(all(question["difficulty"] == "easy" for question in easy["questions"]))
        people = create_session(
            dataset,
            QuizConfig(language="pt-BR", seed="people", theme="people"),
        )
        self.assertTrue(all(question["theme"] == "people" for question in people["questions"]))
        with self.assertRaises(InsufficientQuestionsError):
            create_session(dataset, QuizConfig(language="en", seed="x", theme="unknown"))

    def test_comparisons_use_each_answer_fact_once(self):
        dataset, report = generate_dataset(self.connection)
        comparisons = [
            question
            for question in dataset["questions"]
            if question["language"] == "en"
            and question["type"] == "chronological_comparison"
        ]
        self.assertTrue(all(len(question["fact_base_ids"]) == 4 for question in comparisons))
        answer_fact_ids = []
        for question in comparisons:
            answer_qid = next(
                option["value"]
                for option in question["options"]
                if option["id"] == question["answer_option_id"]
            )
            answer_kind = question["options"][0]["value_type"]
            predicate = "formed_on" if answer_kind == "group" else "born_on"
            statement_id = self.connection.execute(
                """
                SELECT f.statement_id
                FROM facts f JOIN entities e ON e.id=f.subject_entity_id
                WHERE e.wikidata_id=? AND f.predicate=? AND f.status='accepted'
                """,
                (answer_qid, predicate),
            ).fetchone()[0]
            self.assertIn(statement_id, question["fact_base_ids"])
            answer_fact_ids.append(statement_id)
        self.assertEqual(len(answer_fact_ids), len(set(answer_fact_ids)))
        english_questions = [
            question
            for question in dataset["questions"]
            if question["language"] == "en"
        ]
        distinct_fact_ids = {
            fact_id
            for question in english_questions
            for fact_id in question["fact_base_ids"]
        }
        self.assertEqual(
            report["accepted_distinct_fact_bases"],
            len(distinct_fact_ids),
        )
        self.assertLess(
            report["accepted_distinct_fact_bases"],
            report["accepted_logical"],
        )

    def test_schema_rejects_semantic_duplicates_and_invalid_evidence(self):
        dataset, _report = generate_dataset(self.connection)
        duplicate = json.loads(json.dumps(dataset))
        duplicate_question = dict(duplicate["questions"][0])
        duplicate_question["id"] = "f" * 64
        duplicate_question["logical_id"] = "e" * 64
        duplicate["questions"].append(duplicate_question)
        duplicate["logical_question_count"] += 1
        duplicate["language_variant_count"] += 1
        with self.assertRaisesRegex(ValueError, "duplicate semantic"):
            validate_dataset(duplicate)

        invalid_url = json.loads(json.dumps(dataset))
        invalid_url["questions"][0]["evidence"][0]["source_url"] = "http://example.com"
        with self.assertRaisesRegex(ValueError, "evidence.source_url"):
            validate_dataset(invalid_url)

    def test_rejected_conflicting_and_imprecise_facts_do_not_leak(self):
        dataset, report = generate_dataset(self.connection)
        serialized = json.dumps(dataset, ensure_ascii=False)
        self.assertNotIn("Rejected group", serialized)
        self.assertNotIn("Conflicted group", serialized)
        self.assertEqual(
            report["rejected_by_reason"]["fact_rejected__missing_evidence"], 1
        )
        self.assertEqual(
            report["rejected_by_reason"]["fact_conflict__same_rank_values_differ"], 1
        )
        self.assertEqual(report["rejected_by_reason"]["open_conflict"], 1)
        age_text = " ".join(
            question["prompt"]
            for question in dataset["questions"]
            if question["type"] == "age_on_date"
        )
        self.assertNotIn("Person 7", age_text)
        self.assertEqual(report["rejected_by_reason"]["insufficient_precision_for_age"], 1)
        member_at_date = [
            question for question in dataset["questions"]
            if question["type"] == "member_at_date"
        ]
        self.assertEqual(len(member_at_date), 2)
        self.assertIn("membership_interval_not_eligible", report["rejected_by_reason"])
        person_one_age = next(
            question for question in dataset["questions"]
            if question["language"] == "en"
            and question["type"] == "age_on_date"
            and "Person 1" in question["prompt"]
        )
        answer = next(
            option for option in person_one_age["options"]
            if option["id"] == person_one_age["answer_option_id"]
        )
        self.assertEqual(answer["value"], "35")

    def test_portuguese_templates_keep_proper_names_and_english_aliases(self):
        dataset, _report = generate_dataset(self.connection)
        question = next(
            item for item in dataset["questions"]
            if item["language"] == "pt-BR"
            and item["type"] == "formation_year"
            and "Group 1" in item["prompt"]
        )
        self.assertIn("Group 1", question["prompt"])
        self.assertNotIn("Grupo 1", question["prompt"])

    def test_cli_reads_existing_database_and_writes_all_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "facts.db"
            disk = sqlite3.connect(database)
            try:
                self.connection.backup(disk)
            finally:
                disk.close()
            output = root / "questions.json"
            report = root / "report.json"
            session = root / "session.json"
            arguments = [
                "--database", str(database), "--output", str(output),
                "--report", str(report), "--session-output", str(session),
                "--seed", "fixture", "--timer-seconds", "15",
            ]
            self.assertEqual(quiz_main(arguments), 0)
            first_bytes = (output.read_bytes(), report.read_bytes(), session.read_bytes())
            self.assertEqual(quiz_main(arguments), 0)
            self.assertEqual(
                first_bytes,
                (output.read_bytes(), report.read_bytes(), session.read_bytes()),
            )


def build_quiz_database(reverse=False):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE entities(
            id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT
        );
        CREATE TABLE entity_aliases(
            entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT
        );
        CREATE TABLE facts(
            id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER,
            predicate TEXT, property_id TEXT, rank TEXT, value_wikidata_id TEXT,
            value_entity_id INTEGER, value_time TEXT, value_precision INTEGER,
            valid_from TEXT, valid_from_precision INTEGER, valid_to TEXT,
            valid_to_precision INTEGER, qualifiers_json TEXT, references_json TEXT,
            status TEXT, status_reason TEXT, quality_flags_json TEXT, extractor_version TEXT
        );
        CREATE TABLE wikidata_entity_snapshots(
            id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER
        );
        CREATE TABLE source_pages(
            id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER
        );
        CREATE TABLE source_revisions(
            id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER
        );
        CREATE TABLE fact_evidence(
            fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT,
            reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER,
            source_revision_id INTEGER
        );
        """
    )
    entity_specs = [
        (f"QG{index}", "group", f"Group {index}") for index in range(1, 8)
    ] + [
        (f"QL{index}", "organization", f"Label {index}") for index in range(1, 8)
    ] + [
        (f"QP{index}", "person", f"Person {index}") for index in range(1, 8)
    ] + [
        ("QGR", "group", "Rejected group"),
        ("QGC", "group", "Conflicted group"),
    ]
    ordered_entities = list(reversed(entity_specs)) if reverse else entity_specs
    ids = {}
    for qid, entity_type, name in ordered_entities:
        cursor = connection.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
            (qid, entity_type, name),
        )
        ids[qid] = cursor.lastrowid
        connection.execute(
            "INSERT INTO entity_aliases(entity_id, language, name, alias_type) VALUES (?, 'en', ?, 'label')",
            (cursor.lastrowid, name),
        )
    connection.execute(
        "INSERT INTO wikidata_entity_snapshots VALUES (1, 'QSOURCE', 987654)"
    )
    facts = []
    for index in range(1, 8):
        facts.append((f"formation-{index}", f"QG{index}", "formed_on", None, f"200{index}", 9, None, None, None, None, "accepted", None, []))
        precision = 9 if index == 7 else 11
        born = f"199{index}" if precision == 9 else f"199{index}-0{index}-1{index}"
        flags = ["insufficient_precision_for_age"] if precision == 9 else []
        facts.append((f"born-{index}", f"QP{index}", "born_on", None, born, precision, None, None, None, None, "accepted", None, flags))
        if index == 1:
            start, start_precision, end, end_precision, member_flags = (
                "2010-01-01", 11, "2020-01-01", 11, []
            )
        else:
            start = start_precision = end = end_precision = None
            member_flags = ["membership_start_unknown"]
        facts.append((f"has-{index}", f"QG{index}", "has_member", f"QP{index}", None, None, start, start_precision, end, end_precision, "accepted", None, member_flags))
        facts.append((f"member-{index}", f"QP{index}", "member_of", f"QG{index}", None, None, start, start_precision, end, end_precision, "accepted", None, member_flags))
        facts.append((f"label-{index}", f"QG{index}", "record_label", f"QL{index}", None, None, None, None, None, None, "accepted", None, []))
    facts.extend(
        [
            ("rejected", "QGR", "formed_on", None, "2015", 9, None, None, None, None, "rejected", "missing_evidence", []),
            ("conflict", "QGC", "formed_on", None, "2016", 9, None, None, None, None, "conflict", "same_rank_values_differ", []),
            ("conflict-accepted", "QGC", "formed_on", None, "2017", 9, None, None, None, None, "accepted", None, []),
        ]
    )
    ordered_facts = list(reversed(facts)) if reverse else facts
    for item in ordered_facts:
        (
            statement_id, subject_qid, predicate, value_qid, value_time, precision,
            valid_from, valid_from_precision, valid_to, valid_to_precision,
            status, reason, flags,
        ) = item
        cursor = connection.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, value_time, value_precision,
                valid_from, valid_from_precision, valid_to, valid_to_precision,
                qualifiers_json, references_json, status, status_reason,
                quality_flags_json, extractor_version
            ) VALUES (?, ?, ?, 'PTEST', 'normal', ?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, ?, ?, 'fixture-v1')
            """,
            (
                statement_id, ids[subject_qid], predicate, value_qid,
                ids[value_qid] if value_qid else None, value_time, precision,
                valid_from, valid_from_precision, valid_to, valid_to_precision,
                status, reason, json.dumps(flags),
            ),
        )
        if status == "accepted":
            connection.execute(
                """
                INSERT INTO fact_evidence(
                    fact_id, evidence_type, source_key, locator, reference_hash,
                    wikidata_snapshot_id
                ) VALUES (?, 'wikidata_reference', 'domain:example.com', ?, 'ref', 1)
                """,
                (cursor.lastrowid, f"claims/PTEST/{statement_id}/references/ref"),
            )
    connection.commit()
    return connection


if __name__ == "__main__":
    unittest.main()
