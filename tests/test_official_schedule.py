import unittest
from kpop_scraping.official_schedule import (
    ScheduleEntry,
    ScheduleParseError,
    parse_yg_tour_schedule,
)


class TestOfficialSchedule(unittest.TestCase):
    def test_parse_valid_schedule(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="place">KSPO DOME</p>
            <p class="date">2025. 07. 05. SAT 8PM / 2025. 07. 06. SUN 6PM</p>

            <p class="city">MACAU</p>
            <p class="place">GALAXY ARENA</p>
            <p class="date">2025. 07. 19. SAT</p>
            <p class="date2">2025. 07. 20. SUN</p>
        </div>
        """
        entries = parse_yg_tour_schedule(html)
        self.assertEqual(len(entries), 4)

        self.assertEqual(entries[0], ScheduleEntry("SEOUL", "KSPO DOME", "2025-07-05"))
        self.assertEqual(entries[1], ScheduleEntry("SEOUL", "KSPO DOME", "2025-07-06"))
        self.assertEqual(entries[2], ScheduleEntry("MACAU", "GALAXY ARENA", "2025-07-19"))
        self.assertEqual(entries[3], ScheduleEntry("MACAU", "GALAXY ARENA", "2025-07-20"))

        self.assertEqual(entries[0].locator, "SEOUL > KSPO DOME > 2025-07-05")

    def test_missing_blocks(self):
        html = "<div><p>Random text</p></div>"
        with self.assertRaisesRegex(ScheduleParseError, "no destination blocks found"):
            parse_yg_tour_schedule(html)

    def test_incomplete_block_missing_venue(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="date">2025. 07. 05. SAT 8PM</p>
        </div>
        """
        with self.assertRaisesRegex(ScheduleParseError, "incomplete destination block: SEOUL"):
            parse_yg_tour_schedule(html)

    def test_incomplete_block_missing_dates(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="place">KSPO DOME</p>
        </div>
        """
        with self.assertRaisesRegex(ScheduleParseError, "incomplete destination block: SEOUL"):
            parse_yg_tour_schedule(html)

    def test_field_before_city(self):
        html = """
        <div>
            <p class="place">KSPO DOME</p>
            <p class="city">SEOUL</p>
            <p class="date">2025. 07. 05. SAT 8PM</p>
        </div>
        """
        with self.assertRaisesRegex(ScheduleParseError, "place line appears before any city"):
            parse_yg_tour_schedule(html)

    def test_duplicate_dates(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="place">KSPO DOME</p>
            <p class="date">2025. 07. 05. SAT 8PM / 2025. 07. 05. SAT 8PM</p>
        </div>
        """
        with self.assertRaisesRegex(ScheduleParseError, "dates listed more than once: 2025-07-05"):
            parse_yg_tour_schedule(html)

    def test_invalid_date(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="place">KSPO DOME</p>
            <p class="date">2025. 02. 30. SAT 8PM</p>
        </div>
        """
        with self.assertRaisesRegex(ScheduleParseError, "invalid date in schedule line"):
            parse_yg_tour_schedule(html)

    def test_missing_date_pattern(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="place">KSPO DOME</p>
            <p class="date">TBD</p>
        </div>
        """
        with self.assertRaisesRegex(ScheduleParseError, "no date found in schedule line"):
            parse_yg_tour_schedule(html)

    def test_entity_resolution(self):
        html = """
        <div>
            <p class="city">SEOUL</p>
            <p class="place">KSPO DOME &amp; PARK</p>
            <p class="date">2025. 07. 05. SAT 8PM</p>
        </div>
        """
        entries = parse_yg_tour_schedule(html)
        self.assertEqual(entries[0].venue, "KSPO DOME & PARK")

if __name__ == '__main__':
    unittest.main()
