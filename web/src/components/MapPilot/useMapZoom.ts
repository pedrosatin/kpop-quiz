import type { RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { mapPilotFeatures, type MapPilotEvent } from "../../data/map-pilot";
import {
  clientToMap,
  fitScale,
  viewContains,
  WORLD_VIEW,
  zoomedView,
  type MapPoint,
  type MapRect,
} from "./map-pilot-geometry";
import { shapeOf } from "./map-pilot-targets";
import { useMapBox } from "./useMapBox";

/**
 * How long the map ignores a pick after it zooms: the second tap of a double
 * tap lands on the zoomed map, where it would pick another country.
 */
export const ZOOM_GUARD_MS = 300;

export interface MapZoomTurn {
  /** The date on screen; undefined once the round is over. */
  current: MapPilotEvent | undefined;
  questionIndex: number;
  /** The committed answer for the date on screen. */
  selectedFeature: string | null;
}

export interface MapZoom {
  view: MapRect;
  /** Screen pixels per map unit; 0 until the map is measured. */
  scale: number;
  zoomed: boolean;
  /** The next pointer tap on the map zooms instead of selecting. */
  zoomFirst: boolean;
  /** The SVG's click: zooms where a pointer tapped the whole map. */
  zoomAt: (event: MouseEvent) => void;
  zoomOut: () => void;
  /** The click comes from a finger, a pen or a mouse, not from assistive technology. */
  isPointerClick: (event: MouseEvent) => boolean;
  /** No zoom, or one old enough for a tap to pick. */
  settled: () => boolean;
  /** Keyboard focus on a country out of the zoomed view shows the whole map. */
  revealFocused: (feature: { id: string; path: string }) => void;
  pointerHandlers: {
    onPointerDown: (event: PointerEvent) => void;
    onPointerCancel: () => void;
    onKeyDown: () => void;
  };
}

function anchorOf(featureId: string): MapPoint | undefined {
  const feature = mapPilotFeatures.find((candidate) => candidate.id === featureId);
  return feature && shapeOf(feature).anchor;
}

/**
 * An answer whose country is out of the zoomed view shows on the whole map.
 * It runs once per answer, so the player can zoom again after it.
 */
function useRevealAnswer(answerKey: string | null, answerFeature: string | null, view: MapRect | null, zoomOut: () => void) {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (answerKey === shown.current) return;
    shown.current = answerKey;
    const anchor = answerFeature === null ? undefined : anchorOf(answerFeature);
    if (view && anchor && !viewContains(view, anchor)) zoomOut();
  }, [answerKey, answerFeature, view]);
}

/**
 * Below 60rem the first tap on the whole map zooms into the tapped region.
 * Only a pointer zooms: a click from a screen reader, Voice Control or a
 * switch carries no pointerdown (or a detail of 0) and selects the country.
 */
export function useMapZoom(svg: RefObject<SVGSVGElement>, { current, questionIndex, selectedFeature }: MapZoomTurn): MapZoom {
  const { box, narrow } = useMapBox(svg);
  const [center, setCenter] = useState<MapPoint | null>(null);
  const zoomedAt = useRef(-Infinity);
  // Where a pointer went down on the map since its last click, key press or
  // cancel. The zoom centers there: Chrome moves a tap's click onto the
  // nearest clickable shape, and a tap on the sea by Luzon zoomed on Taiwan.
  const pointerDown = useRef<MapPoint | null>(null);
  // Zoom only helps where the list is a select: on wide screens the list
  // beside the map already reaches every country.
  const zoomable = narrow && box.width > 0 && current !== undefined;
  const zoomCenter = zoomable ? center : null;
  const zoomedRect = useMemo(() => (zoomCenter ? zoomedView(zoomCenter, box) : null), [zoomCenter, box]);
  const view = zoomedRect ?? WORLD_VIEW;
  const zoomed = zoomedRect !== null;
  const zoomOut = () => setCenter(null);

  // Every date starts from the whole map, and so does a screen that turns wide.
  useEffect(zoomOut, [questionIndex]);
  useEffect(() => {
    if (!zoomable) zoomOut();
  }, [zoomable]);

  const answerFeature = selectedFeature === null ? null : current?.map_feature_id ?? null;
  useRevealAnswer(answerFeature && `${questionIndex}:${answerFeature}`, answerFeature, zoomedRect, zoomOut);

  const isPointerClick = (event: MouseEvent) => pointerDown.current !== null && event.detail > 0;

  function zoomAt(event: MouseEvent) {
    const down = pointerDown.current;
    pointerDown.current = null;
    if (!down || event.detail === 0 || !zoomable || zoomed || !svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    zoomedAt.current = performance.now();
    setCenter(clientToMap(
      down,
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      WORLD_VIEW,
    ));
  }

  function revealFocused(feature: { id: string; path: string }) {
    // A tap or a click focuses the country before its click; only Tab reveals.
    if (zoomed && pointerDown.current === null && !viewContains(view, shapeOf(feature).anchor)) zoomOut();
  }

  const clearPointer = () => { pointerDown.current = null; };

  return {
    view,
    scale: fitScale(box, view),
    zoomed,
    zoomFirst: zoomable && !zoomed,
    zoomAt,
    zoomOut,
    isPointerClick,
    settled: () => !zoomed || performance.now() - zoomedAt.current >= ZOOM_GUARD_MS,
    revealFocused,
    pointerHandlers: {
      onPointerDown: (event: PointerEvent) => { pointerDown.current = { x: event.clientX, y: event.clientY }; },
      onPointerCancel: clearPointer,
      onKeyDown: clearPointer,
    },
  };
}
