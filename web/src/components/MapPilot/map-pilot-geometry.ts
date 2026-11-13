/*
  Geometry of the map view. The world map is an equirectangular 1200x600 SVG
  (3.33 units per degree), cropped to 84°N–60°S. On narrow screens the first
  tap zooms into the tapped region at ZOOM_PX_PER_UNIT, where every country
  of the round gets a round target of TARGET_RADIUS_PX: at 360px wide the
  world view gives Singapore 0.2px, Taiwan 3px and South Korea 5px.
*/

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface FeatureShape {
  /** Center of the bounding box of the largest ring: inside or next to the mainland. */
  anchor: MapPoint;
  /** Bounding box of every ring. */
  width: number;
  height: number;
}

// The polar rows hold no tour dates.
export const WORLD_VIEW: MapRect = { x: 0, y: 20, width: 1200, height: 480 };

/**
 * 2px per unit is 6.7px per degree. The closest anchors of the round's
 * countries (the Philippines and Taiwan) are 26.9 units apart, so two 44px
 * targets keep about 10px between them.
 */
export const ZOOM_PX_PER_UNIT = 2;
/** Half of the 44px touch target (--control-height). */
export const TARGET_RADIUS_PX = 22;
/** A country smaller than a target gets a visible ring in the zoomed view. */
export const RING_BELOW_PX = 2 * TARGET_RADIUS_PX;
/** In the whole map a country smaller than this gets a dot so it can be seen. */
export const DOT_BELOW_PX = 8;
export const DOT_RADIUS_PX = 5;

function ringArea(points: MapPoint[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function bounds(points: MapPoint[]): MapRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Reads the M/L/Z paths written by scripts/build_map_pilot_map.py. */
export function featureShape(path: string): FeatureShape {
  const rings = path
    .split(/Z/i)
    .map((ring) => [...ring.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]) })))
    .filter((ring) => ring.length > 0);
  if (rings.length === 0) return { anchor: { x: 0, y: 0 }, width: 0, height: 0 };
  // Singapore is a two-point ring at this scale: with no area, the first ring wins.
  const largest = rings.reduce((best, ring) => (ringArea(ring) > ringArea(best) ? ring : best));
  const main = bounds(largest);
  const all = bounds(rings.flat());
  return {
    anchor: { x: main.x + main.width / 2, y: main.y + main.height / 2 },
    width: all.width,
    height: all.height,
  };
}

/** Screen pixels per map unit for a view drawn with preserveAspectRatio "xMidYMid meet". */
export function fitScale(box: MapSize, view: MapRect): number {
  if (box.width <= 0 || box.height <= 0) return 0;
  return Math.min(box.width / view.width, box.height / view.height);
}

/** Map point under a click, from the SVG's client rectangle and its view box. */
export function clientToMap(client: MapPoint, rect: MapRect, view: MapRect): MapPoint {
  const scale = fitScale(rect, view);
  if (scale === 0) return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const offsetX = (rect.width - view.width * scale) / 2;
  const offsetY = (rect.height - view.height * scale) / 2;
  return {
    x: view.x + (client.x - rect.x - offsetX) / scale,
    y: view.y + (client.y - rect.y - offsetY) / scale,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The zoomed view around a point: the box's shape, kept inside the world view. */
export function zoomedView(center: MapPoint, box: MapSize): MapRect {
  const width = Math.min(box.width / ZOOM_PX_PER_UNIT, WORLD_VIEW.width);
  const height = Math.min(box.height / ZOOM_PX_PER_UNIT, WORLD_VIEW.height);
  return {
    x: clamp(center.x - width / 2, WORLD_VIEW.x, WORLD_VIEW.x + WORLD_VIEW.width - width),
    y: clamp(center.y - height / 2, WORLD_VIEW.y, WORLD_VIEW.y + WORLD_VIEW.height - height),
    width,
    height,
  };
}

export function viewContains(view: MapRect, point: MapPoint): boolean {
  return point.x >= view.x && point.x <= view.x + view.width
    && point.y >= view.y && point.y <= view.y + view.height;
}

export function viewBoxValue(view: MapRect): string {
  return [view.x, view.y, view.width, view.height].map((value) => Number(value.toFixed(2))).join(" ");
}
