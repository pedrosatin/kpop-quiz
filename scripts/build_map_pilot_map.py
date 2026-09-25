"""Download Natural Earth and emit compact SVG paths for the map pilot.

Natural Earth country data is public domain. The output stores only feature
IDs, display labels, Wikidata and ISO identifiers and simplified paths; no schedule source content is copied.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "v5.1.1/geojson/ne_10m_admin_0_countries.geojson"
)
USER_AGENT = "kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-quiz)"
WIDTH = 1200
HEIGHT = 600
SIMPLIFY_PX = 0.35


def download_features() -> dict[str, Any]:
    request = Request(SOURCE_URL, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def project(point: list[float]) -> tuple[float, float]:
    longitude, latitude = point[:2]
    x = (longitude + 180) / 360 * WIDTH
    y = (90 - latitude) / 180 * HEIGHT
    return x, y


def distance_to_segment(
    point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]
) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    ratio = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    nearest = (start[0] + ratio * dx, start[1] + ratio * dy)
    return math.hypot(point[0] - nearest[0], point[1] - nearest[1])


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) < 4:
        return points
    stack = [(0, len(points) - 1)]
    kept = {0, len(points) - 1}
    while stack:
        start, end = stack.pop()
        furthest = max(
            range(start + 1, end),
            key=lambda index: distance_to_segment(points[index], points[start], points[end]),
            default=None,
        )
        if furthest is None:
            continue
        distance = distance_to_segment(points[furthest], points[start], points[end])
        if distance > tolerance:
            kept.add(furthest)
            stack.extend(((start, furthest), (furthest, end)))
    return [points[index] for index in sorted(kept)]


def split_antimeridian_ring(ring: list[list[float]]) -> list[list[list[float]]]:
    chunks: list[list[list[float]]] = [[]]
    previous: list[float] | None = None
    for point in ring:
        if previous is not None and abs(point[0] - previous[0]) > 180:
            if chunks[-1]:
                chunks.append([])
        chunks[-1].append(point)
        previous = point
    return [chunk for chunk in chunks if len(chunk) >= 3]


def ring_path(ring: list[list[float]]) -> str:
    chunks: list[str] = []
    for segment in split_antimeridian_ring(ring):
        points = simplify([project(point) for point in segment], SIMPLIFY_PX)
        if len(points) < 3:
            continue
        first_x, first_y = points[0]
        commands = [f"M{first_x:.1f},{first_y:.1f}"]
        commands.extend(f"L{x:.1f},{y:.1f}" for x, y in points[1:])
        commands.append("Z")
        chunks.append("".join(commands))
    return "".join(chunks)


def geometry_path(geometry: dict[str, Any] | None) -> str:
    if not geometry:
        return ""
    coordinates = geometry.get("coordinates", [])
    polygons = [coordinates] if geometry.get("type") == "Polygon" else coordinates
    return "".join(ring_path(ring) for polygon in polygons for ring in polygon)


def build_map(features: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for feature in features.get("features", []):
        properties = feature.get("properties") or {}
        feature_id = properties.get("ADM0_A3")
        path = geometry_path(feature.get("geometry"))
        if isinstance(feature_id, str) and path:
            rows.append(
                {
                    "id": feature_id,
                    "label": properties.get("ADMIN") or feature_id,
                    "wikidata_id": properties.get("WIKIDATAID"),
                    "iso_a2": properties.get("ISO_A2"),
                    "path": path,
                }
            )
    rows.sort(key=lambda row: row["id"])
    return {
        "schema_version": "natural-earth-map-paths-v2",
        "dataset": {
            "name": "Natural Earth Admin 0 - Countries",
            "version": "5.1.1",
            "scale": "1:10m",
            "source_url": SOURCE_URL,
            "credit": "Made with Natural Earth.",
        },
        "view_box": f"0 0 {WIDTH} {HEIGHT}",
        "features": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("web/src/data/map-pilot/world-map.json"),
    )
    args = parser.parse_args()
    payload = build_map(download_features())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['features'])} map features to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
