from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

SKIP_REASON = "jsonschema is not installed (install via requirements-ci.txt)"

try:
    from jsonschema import Draft202012Validator, FormatChecker, ValidationError
    from referencing import Registry, Resource
except ImportError:
    jsonschema_available = False
    Draft202012Validator = None  # type: ignore[assignment, misc]
    FormatChecker = None  # type: ignore[assignment, misc]
    ValidationError = Exception  # type: ignore[assignment, misc]
    Registry = None  # type: ignore[assignment, misc]
    Resource = None  # type: ignore[assignment, misc]
else:
    jsonschema_available = True

from kpop_scraping.web_publish import (
    CODE_GROUPS_DAILY_FILENAME,
    CONNECTIONS_DAILY_FILENAME,
    CROSSWORD_DAILY_FILENAME,
    GRID_DAILY_FILENAME,
    NAME_GUESS_DAILY_FILENAME,
    STRANDS_DAILY_FILENAME,
    TIMELINE_DAILY_FILENAME,
    WORD_SEARCH_DAILY_FILENAME,
    publish,
)
from tests.daily_fixtures import strands_puzzle_for
from tests.published_schema_map import (
    SCHEMAS_ROOT,
    WEB_DATA_ROOT,
    classify_directory,
    load_artifact_map,
)
from tests.test_grid_schema import sample_intersection_grid
from tests.test_web_publish import build_code_groups_puzzle

FIXTURES = Path(__file__).parent / "fixtures" / "web_publish"
PUBLISHED = Path(__file__).resolve().parents[1] / "web" / "public" / "data"


def _load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _schema_registry() -> Registry:
    resources = []
    for path in sorted(SCHEMAS_ROOT.glob("*.json")):
        if path.name == "artifact-map.json":
            continue
        contents = json.loads(path.read_text(encoding="utf-8"))
        resource = Resource.from_contents(contents)
        resources.append((path.name, resource))
        schema_id = contents.get("$id")
        if isinstance(schema_id, str) and schema_id:
            resources.append((schema_id, resource))
    return Registry().with_resources(resources)


def _validator_for(schema_file: str, registry: Registry) -> Draft202012Validator:
    schema = json.loads((SCHEMAS_ROOT / schema_file).read_text(encoding="utf-8"))
    return Draft202012Validator(
        schema,
        registry=registry,
        format_checker=FormatChecker(),
    )


def validate_data_dir(data_root: Path) -> list[str]:
    if not jsonschema_available:
        raise RuntimeError(SKIP_REASON)
    artifact_map = load_artifact_map()
    with_schema, _without, unknown = classify_directory(data_root, artifact_map)
    if unknown:
        return [f"artefatos novos sem mapa nem lista: {', '.join(unknown)}"]

    registry = _schema_registry()
    validators: dict[str, Draft202012Validator] = {}
    failures: list[str] = []
    for relative_path, schema_file in with_schema:
        validator = validators.get(schema_file)
        if validator is None:
            validator = _validator_for(schema_file, registry)
            validators[schema_file] = validator
        payload = _load_json(data_root / relative_path)
        try:
            validator.validate(payload)
        except ValidationError as exc:
            path = "/" + "/".join(str(part) for part in exc.absolute_path) if exc.absolute_path else "/"
            failures.append(f"{relative_path} → {schema_file}: {path} {exc.message}")
    return failures


@unittest.skipUnless(jsonschema_available, SKIP_REASON)
class PublishedSchemasTest(unittest.TestCase):
    def test_artifact_map_matches_adr_allow_list(self):
        without = sorted(load_artifact_map()["without_schema"])
        self.assertEqual(
            without,
            [
                "catalog-manifest-v1.json",
                "catalog.<locale>.<mode>.<sha256>.json",
                "crossword-publication.<date>.json",
                "daily-set.json",
                "manifest-v2.json",
                "manifest-v3.json",
                "manifest.json",
                "map-pilot/**",
            ],
        )

    def test_publisher_output_validates_against_schemas(self):
        sessions = _load_json(FIXTURES / "sessions.json")
        crossword = _load_json(PUBLISHED / CROSSWORD_DAILY_FILENAME)
        with tempfile.TemporaryDirectory(prefix="published_schemas_") as directory:
            output = Path(directory)
            publish(
                output,
                sessions,
                grid=sample_intersection_grid(),
                connections=_load_json(FIXTURES / CONNECTIONS_DAILY_FILENAME),
                name_guess=_load_json(FIXTURES / NAME_GUESS_DAILY_FILENAME),
                word_search=_load_json(FIXTURES / WORD_SEARCH_DAILY_FILENAME),
                timeline=_load_json(FIXTURES / TIMELINE_DAILY_FILENAME),
                code_groups=build_code_groups_puzzle(),
                crossword=crossword,
                strands=strands_puzzle_for("2026-10-20"),
            )
            (output / "daily-set.json").write_text(
                json.dumps(
                    {
                        "schema_version": "kpop-daily-set-v1",
                        "reference_date": "2026-10-20",
                        "omitted": {},
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            failures = validate_data_dir(output)
            self.assertEqual(failures, [], msg="\n".join(failures))
            with_schema, without_schema, unknown = classify_directory(output)
            self.assertEqual(unknown, [])
            self.assertGreater(len(with_schema), 0)
            basenames = {Path(path).name for path, _ in with_schema}
            for name in (
                CONNECTIONS_DAILY_FILENAME,
                GRID_DAILY_FILENAME,
                NAME_GUESS_DAILY_FILENAME,
                WORD_SEARCH_DAILY_FILENAME,
                TIMELINE_DAILY_FILENAME,
                CODE_GROUPS_DAILY_FILENAME,
                CROSSWORD_DAILY_FILENAME,
                STRANDS_DAILY_FILENAME,
            ):
                self.assertIn(name, basenames)
            list_entries = {entry for _, entry in without_schema}
            self.assertIn("manifest-v2.json", list_entries)
            self.assertIn("daily-set.json", list_entries)

    def test_extra_field_on_generated_artifact_fails_schema(self):
        sessions = _load_json(FIXTURES / "sessions.json")
        with tempfile.TemporaryDirectory(prefix="published_schemas_mut_") as directory:
            output = Path(directory)
            publish(
                output,
                sessions,
                connections=_load_json(FIXTURES / CONNECTIONS_DAILY_FILENAME),
            )
            target = output / CONNECTIONS_DAILY_FILENAME
            payload = _load_json(target)
            self.assertIsInstance(payload, dict)
            mutated = copy.deepcopy(payload)
            mutated["unexpected_extra_field"] = "mutation-proof"
            target.write_text(json.dumps(mutated) + "\n", encoding="utf-8")
            failures = validate_data_dir(output)
            self.assertTrue(
                failures,
                msg="expected schema failure after adding an extra field",
            )
            self.assertTrue(
                any(CONNECTIONS_DAILY_FILENAME in item for item in failures),
                msg=f"failures did not mention connections: {failures}",
            )
            target.write_text(json.dumps(payload) + "\n", encoding="utf-8")
            restored = validate_data_dir(output)
            self.assertEqual(restored, [], msg="\n".join(restored))

    def test_unknown_artifact_fails_classification(self):
        with tempfile.TemporaryDirectory(prefix="published_schemas_unk_") as directory:
            output = Path(directory)
            (output / "brand-new-game.daily.json").write_text("{}\n", encoding="utf-8")
            _with, _without, unknown = classify_directory(output)
            self.assertEqual(unknown, ["brand-new-game.daily.json"])
            failures = validate_data_dir(output)
            self.assertTrue(any("brand-new-game.daily.json" in item for item in failures))


@unittest.skipUnless(jsonschema_available, SKIP_REASON)
class PublishedWebDataSchemasTest(unittest.TestCase):
    def test_web_public_data_validates_against_schemas(self):
        self.assertTrue(WEB_DATA_ROOT.is_dir(), msg=f"missing {WEB_DATA_ROOT}")
        failures = validate_data_dir(WEB_DATA_ROOT)
        self.assertEqual(failures, [], msg="\n".join(failures))
        with_schema, without_schema, unknown = classify_directory(WEB_DATA_ROOT)
        self.assertEqual(unknown, [])
        self.assertGreater(len(with_schema), 0)
        self.assertGreater(len(without_schema), 0)


if __name__ == "__main__":
    unittest.main()
