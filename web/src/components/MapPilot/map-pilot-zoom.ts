/*
  When the narrow map zooms and when it goes back to the whole map, as pure
  functions of the screen, the turn and the last pointer press. useMapZoom
  holds the state and the events.
*/
import type { MapPilotEvent } from "../../data/map-pilot";
import { viewContains, type MapPoint, type MapRect, type MapSize } from "./map-pilot-geometry";
import { shapeOf } from "./map-pilot-targets";

/**
 * How long the map ignores a pick after it zooms: the second tap of a double
 * tap lands on the zoomed map, where it would pick another country.
 */
export const ZOOM_GUARD_MS = 300;

/**
 * Zoom only helps where the list is a select: on wide screens the list
 * beside the map already reaches every country. It also waits for the map
 * to be measured and stops at the end of the round.
 */
export function isMapZoomable(narrow: boolean, box: MapSize, current: MapPilotEvent | undefined): boolean {
  return narrow && box.width > 0 && current !== undefined;
}

/** The answer the map shows once the date on screen is answered; both null before that. */
export interface ShownAnswer {
  /** One per answer, so the map reveals each answer only once. */
  key: string | null;
  feature: string | null;
}

const NO_ANSWER_SHOWN: ShownAnswer = { key: null, feature: null };

export function shownAnswer(
  current: MapPilotEvent | undefined,
  questionIndex: number,
  selectedFeature: string | null,
): ShownAnswer {
  if (selectedFeature === null || !current) return NO_ANSWER_SHOWN;
  return { key: `${questionIndex}:${current.map_feature_id}`, feature: current.map_feature_id };
}

/**
 * A pointer click zooms when it counts a press and the whole map shows on a
 * screen that zooms. Assistive technology sends a click with a detail of 0,
 * and that click selects the country.
 */
export function zoomsOnClick(detail: number, zoomable: boolean, zoomed: boolean): boolean {
  return detail !== 0 && zoomable && !zoomed;
}

/** No zoom, or one old enough for a tap to pick. */
export function isZoomSettled(zoomed: boolean, msSinceZoom: number): boolean {
  return !zoomed || msSinceZoom >= ZOOM_GUARD_MS;
}

/**
 * A tap or a click focuses the country before its click, so only keyboard
 * focus on a country out of the zoomed view shows the whole map.
 */
export function revealsFocusedCountry(
  zoomed: boolean,
  pointerDown: MapPoint | null,
  view: MapRect,
  feature: { id: string; path: string },
): boolean {
  return zoomed && pointerDown === null && !viewContains(view, shapeOf(feature).anchor);
}
