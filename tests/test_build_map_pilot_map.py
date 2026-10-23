import unittest
from scripts.build_map_pilot_map import geometry_path


class TestGeometryPath(unittest.TestCase):
    def test_geometry_path_returns_empty_string_for_none(self):
        self.assertEqual(geometry_path(None), "")
        self.assertEqual(geometry_path({}), "")

    def test_geometry_path_polygon(self):
        # A simple 1x1 degree square at the origin
        geometry = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [1, 1], [0, 1], [0, 0]]],
        }
        # Width=1200, Height=600. [0,0] -> x=(0+180)/360*1200=600, y=(90-0)/180*600=300
        # [1,1] -> x=181/360*1200=603.3, y=89/180*600=296.7
        # [0,1] -> x=180/360*1200=600, y=89/180*600=296.7
        self.assertEqual(
            geometry_path(geometry), "M600.0,300.0L603.3,296.7L600.0,296.7L600.0,300.0Z"
        )

    def test_geometry_path_multipolygon(self):
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[0, 0], [1, 1], [0, 1], [0, 0]]],
                [[[10, 10], [11, 11], [10, 11], [10, 10]]],
            ],
        }
        # Polygon 1: same as above
        # Polygon 2:
        # [10,10] -> x=190/360*1200=633.3, y=80/180*600=266.7
        # [11,11] -> x=191/360*1200=636.7, y=79/180*600=263.3
        # [10,11] -> x=190/360*1200=633.3, y=79/180*600=263.3
        self.assertEqual(
            geometry_path(geometry),
            "M600.0,300.0L603.3,296.7L600.0,296.7L600.0,300.0ZM633.3,266.7L636.7,263.3L633.3,263.3L633.3,266.7Z",
        )


if __name__ == "__main__":
    unittest.main()
