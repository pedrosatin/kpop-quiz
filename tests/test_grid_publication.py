"""Strict boundary tests for grid correction metadata."""
import unittest
from copy import deepcopy
from kpop_scraping.grid_publication import publication, validate_publication


class GridPublicationTest(unittest.TestCase):
    def test_valid_normal_corrected_and_unavailable(self):
        grid = dict(grid_id='a'*64, reference_date='2026-10-25')
        validate_publication(publication('2026-10-25', grid))
        validate_publication(publication('2026-10-25', grid, rejected_id='b'*64))
        validate_publication(publication('2026-10-25', None, rejected_id='b'*64))

    def test_invalid_version_date_hash_and_replacement_are_rejected(self):
        valid = publication('2026-10-25', dict(grid_id='a'*64, reference_date='2026-10-25'))
        for field, value in [('schema_version', 'v2'), ('reference_date', '2026-02-30'),
                             ('reference_date', '../path'), ('grid_id', '<script>'),
                             ('grid_id', 42), ('grid_reference_date', '2026-10-26'),
                             ('replaces', ['a'*64]), ('replaces', ['b'*64]*2),
                             ('replaces', 'b'*64), ('replaces', [None])]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                value_copy = deepcopy(valid)
                value_copy[field] = value
                validate_publication(value_copy)

    def test_correction_history_is_cumulative_and_cannot_reuse_identity(self):
        old = publication('2026-10-25', dict(grid_id='a'*64, reference_date='2026-10-25'), rejected_id='b'*64)
        new = publication('2026-10-25', dict(grid_id='c'*64, reference_date='2026-10-25'), old, 'a'*64)
        self.assertEqual(new['replaces'], ['a'*64, 'b'*64])
        with self.assertRaises(ValueError):
            publication('2026-10-25', dict(grid_id='b'*64, reference_date='2026-10-25'), old)
