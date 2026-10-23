import unittest

# Need to import build_map_pilot_map which is in scripts/
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent / "scripts"))
import build_map_pilot_map


class TestBuildMapPilotMap(unittest.TestCase):
    def test_project(self):
        # Center of the map
        self.assertEqual(build_map_pilot_map.project([0, 0]), (600.0, 300.0))
        # Top-left corner
        self.assertEqual(build_map_pilot_map.project([-180, 90]), (0.0, 0.0))
        # Bottom-right corner
        self.assertEqual(build_map_pilot_map.project([180, -90]), (1200.0, 600.0))
        # Extra item in list should be ignored
        self.assertEqual(build_map_pilot_map.project([0, 0, 100]), (600.0, 300.0))


if __name__ == "__main__":
    unittest.main()
