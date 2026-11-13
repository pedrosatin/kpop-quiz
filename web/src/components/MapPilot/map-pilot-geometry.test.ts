import { describe, expect, it } from "vitest";
import { mapPilotCountries, mapPilotFeatures } from "../../data/map-pilot";
import {
  clientToMap,
  featureShape,
  fitScale,
  TARGET_RADIUS_PX,
  viewContains,
  WORLD_VIEW,
  ZOOM_PX_PER_UNIT,
  zoomedView,
} from "./map-pilot-geometry";

const candidates = mapPilotCountries.map((country) => {
  const feature = mapPilotFeatures.find((candidate) => candidate.id === country.map_feature_id)!;
  return { id: feature.id, shape: featureShape(feature.path) };
});

// A 360px phone: the card leaves the map 298px wide, and the box is 5:3 up to 170px.
const PHONE = { width: 298, height: 170 };

describe("map pilot geometry", () => {
  it("keeps the zoomed 44px targets of the round's countries apart", () => {
    // Two targets overlap when their centers are closer than two radii.
    // A data refresh that adds a country this close needs another zoom.
    const minUnits = (2 * TARGET_RADIUS_PX) / ZOOM_PX_PER_UNIT;
    for (const [index, a] of candidates.entries()) {
      for (const b of candidates.slice(index + 1)) {
        const distance = Math.hypot(a.shape.anchor.x - b.shape.anchor.x, a.shape.anchor.y - b.shape.anchor.y);
        expect(distance, `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(minUnits);
      }
    }
  });

  it("anchors each country inside the map and inside the view zoomed on it", () => {
    for (const { id, shape } of candidates) {
      expect(viewContains(WORLD_VIEW, shape.anchor), id).toBe(true);
      const view = zoomedView(shape.anchor, PHONE);
      // The target fits whole in the view, so a tap at its center reaches it.
      const radius = TARGET_RADIUS_PX / fitScale(PHONE, view);
      expect(shape.anchor.x - radius, id).toBeGreaterThanOrEqual(view.x - 0.01);
      expect(shape.anchor.x + radius, id).toBeLessThanOrEqual(view.x + view.width + 0.01);
      expect(shape.anchor.y - radius, id).toBeGreaterThanOrEqual(view.y - 0.01);
      expect(shape.anchor.y + radius, id).toBeLessThanOrEqual(view.y + view.height + 0.01);
    }
  });

  it("reads Singapore, a two-point ring at this scale, as a point", () => {
    const singapore = candidates.find((candidate) => candidate.id === "SGP")!.shape;
    expect(singapore.width).toBeLessThan(2);
    expect(singapore.anchor.x).toBeCloseTo(946, 0);
    expect(singapore.anchor.y).toBeCloseTo(295.5, 0);
  });

  it("anchors a country on its largest ring, not on its overseas parts", () => {
    // France's feature reaches French Guiana and Réunion; the anchor stays in Europe.
    const france = candidates.find((candidate) => candidate.id === "FRA")!.shape;
    expect(france.width).toBeGreaterThan(300);
    expect(france.anchor.x).toBeGreaterThan(590);
    expect(france.anchor.x).toBeLessThan(620);
  });

  it("zooms to 2px per unit in the box's shape and stays inside the world", () => {
    const view = zoomedView({ x: 600, y: 200 }, PHONE);
    expect(view.width).toBeCloseTo(PHONE.width / ZOOM_PX_PER_UNIT);
    expect(view.height).toBeCloseTo(PHONE.height / ZOOM_PX_PER_UNIT);
    expect(fitScale(PHONE, view)).toBeCloseTo(ZOOM_PX_PER_UNIT);

    const corner = zoomedView({ x: 0, y: 0 }, PHONE);
    expect(corner.x).toBe(WORLD_VIEW.x);
    expect(corner.y).toBe(WORLD_VIEW.y);
    const farCorner = zoomedView({ x: 5000, y: 5000 }, PHONE);
    expect(farCorner.x + farCorner.width).toBeCloseTo(WORLD_VIEW.x + WORLD_VIEW.width);
    expect(farCorner.y + farCorner.height).toBeCloseTo(WORLD_VIEW.y + WORLD_VIEW.height);
  });

  it("maps a click to the point under it on a letterboxed map", () => {
    // 1200x480 in a 300x180 box: 0.25px per unit and 30px of sea above and below.
    const rect = { x: 10, y: 100, width: 300, height: 180 };
    const point = clientToMap({ x: 10 + 946 * 0.25, y: 100 + 30 + (295.5 - 20) * 0.25 }, rect, WORLD_VIEW);
    expect(point.x).toBeCloseTo(946);
    expect(point.y).toBeCloseTo(295.5);
  });
});
