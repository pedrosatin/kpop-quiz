import unittest

from kpop_scraping.entities import (
    GREGORIAN_CALENDAR,
    TimeValueError,
    canonical_name,
    extract_aliases,
    instance_of,
    matching_names,
    parse_statements,
    parse_time,
)

from .wikidata_fixture import SUNMI, SUNYE, TWICE, WONDER_GIRLS, load_fixture


def time_value(time, precision, calendar=GREGORIAN_CALENDAR):
    return {
        "after": 0,
        "before": 0,
        "calendarmodel": calendar,
        "precision": precision,
        "time": time,
        "timezone": 0,
    }


class TimeParsingTest(unittest.TestCase):
    def test_value_is_truncated_to_declared_precision(self):
        self.assertEqual(parse_time(time_value("+2007-01-01T00:00:00Z", 9)).value, "2007")
        self.assertEqual(parse_time(time_value("+2015-07-00T00:00:00Z", 10)).value, "2015-07")
        day = parse_time(time_value("+1995-09-22T00:00:00Z", 11))
        self.assertEqual((day.value, day.precision), ("1995-09-22", 11))

    def test_rejects_decade_precision_and_julian_calendar(self):
        with self.assertRaises(TimeValueError) as decade:
            parse_time(time_value("+1990-00-00T00:00:00Z", 8))
        self.assertEqual(decade.exception.reason, "insufficient_precision")
        with self.assertRaises(TimeValueError) as julian:
            parse_time(
                time_value(
                    "+1900-01-01T00:00:00Z",
                    11,
                    "http://www.wikidata.org/entity/Q1985786",
                )
            )
        self.assertEqual(julian.exception.reason, "unsupported_calendar_model")

    def test_rejects_invalid_civil_date(self):
        with self.assertRaises(TimeValueError) as invalid:
            parse_time(time_value("+2023-02-29T00:00:00Z", 11))
        self.assertEqual(invalid.exception.reason, "invalid_time_value")

    def test_refinement_is_compatible_and_different_days_are_not(self):
        year = parse_time(time_value("+2015-00-00T00:00:00Z", 9))
        day = parse_time(time_value("+2015-10-20T00:00:00Z", 11))
        other = parse_time(time_value("+2016-10-20T00:00:00Z", 11))
        self.assertTrue(year.compatible_with(day))
        self.assertFalse(day.compatible_with(other))


class EntityParsingTest(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()

    def test_aliases_include_languages_native_name_and_romanization(self):
        aliases = extract_aliases(self.fixture["subject_profile"][TWICE])
        found = {(alias.alias_type, alias.language, alias.name) for alias in aliases}
        self.assertIn(("label", "en", "Twice"), found)
        self.assertIn(("label", "ko", "트와이스"), found)
        self.assertIn(("alias", "ko", "TWICE"), found)
        self.assertIn(("native_name", "ko", "트와이스"), found)
        self.assertIn(("romanization", "ko-Latn-RR", "Towaisu"), found)
        self.assertIn("Towaisu", matching_names(aliases))
        self.assertNotIn("트와이스", matching_names(aliases))

    def test_canonical_name_falls_back_to_english_alias(self):
        # Sunmi's entity has only a Korean label in the requested languages.
        self.assertEqual(canonical_name(self.fixture["subject_profile"][SUNMI]), "Lee Sunmi")

    def test_statement_keeps_rank_references_and_temporal_qualifiers(self):
        entity = self.fixture["subject_profile"][SUNYE]
        dated, undated = parse_statements(entity, ("P463",))
        self.assertEqual(dated.rank, "normal")
        self.assertEqual(dated.item_id, WONDER_GIRLS)
        self.assertEqual(dated.start_times[0].time.value, "2007-02")
        self.assertEqual(dated.end_times[0].time.value, "2015")
        self.assertEqual(dated.references[0].properties, ("P143",))
        self.assertEqual(undated.start_times, ())
        self.assertEqual(instance_of(entity), frozenset({"Q5"}))


if __name__ == "__main__":
    unittest.main()
