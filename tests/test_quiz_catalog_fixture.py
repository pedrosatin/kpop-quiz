"""The catalog fixture the web tests read is the one the publisher writes.

``web/src/tests/fixtures/catalog`` holds a small published catalog (twelve
logical questions) so the TypeScript consumer is tested against bytes made by
the Python publisher, not against a hand-made imitation of them. Regenerate it
with ``UPDATE_CATALOG_FIXTURE=1 python -m unittest tests.test_quiz_catalog_fixture``
after a deliberate contract change.
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.quiz_catalog import CATALOG_MANIFEST_FILENAME, build_catalog, publish_catalog
from kpop_scraping.quiz_generator import generate_dataset
from tests.test_quiz_generator import build_quiz_database

FIXTURE = Path(__file__).parents[1] / "web" / "src" / "tests" / "fixtures" / "catalog"
LOGICAL_QUESTIONS = 12


def fixture_shards() -> dict:
    connection = build_quiz_database()
    try:
        dataset, _ = generate_dataset(connection)
    finally:
        connection.close()
    keep = sorted({question["logical_id"] for question in dataset["questions"]})[:LOGICAL_QUESTIONS]
    questions = [question for question in dataset["questions"] if question["logical_id"] in keep]
    dataset = {
        **dataset,
        "questions": questions,
        "logical_question_count": len(keep),
        "language_variant_count": len(questions),
    }
    return build_catalog(dataset)


class CatalogFixtureTest(unittest.TestCase):
    def test_the_fixture_is_what_the_publisher_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            generated = Path(tmp) / "catalog"
            publish_catalog(generated, fixture_shards())
            if os.environ.get("UPDATE_CATALOG_FIXTURE") == "1":
                shutil.rmtree(FIXTURE, ignore_errors=True)
                shutil.copytree(generated, FIXTURE)
            expected = {path.name: path.read_bytes() for path in sorted(generated.iterdir())}
            published = {path.name: path.read_bytes() for path in sorted(FIXTURE.iterdir())}
            self.assertEqual(published, expected)
            self.assertIn(CATALOG_MANIFEST_FILENAME, published)


if __name__ == "__main__":
    unittest.main()
