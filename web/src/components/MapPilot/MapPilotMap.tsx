import { useEffect, useRef, useState } from "preact/hooks";
import {
  mapPilotCountryLabel,
  mapPilotFeatures,
  mapPilotMetadata,
  type MapPilotCountry,
  type MapPilotEvent,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import type { MapPilotCopy } from "./map-pilot-copy";
import {
  clientToMap,
  DOT_BELOW_PX,
  DOT_RADIUS_PX,
  featureShape,
  fitScale,
  RING_BELOW_PX,
  TARGET_RADIUS_PX,
  viewBoxValue,
  viewContains,
  WORLD_VIEW,
  zoomedView,
  type FeatureShape,
  type MapPoint,
} from "./map-pilot-geometry";
import { useMapBox } from "./useMapBox";

const shapeCache = new Map<string, FeatureShape>();

/** Shapes are read only for the features that get a target, once per page. */
function shapeOf(feature: { id: string; path: string }): FeatureShape {
  let shape = shapeCache.get(feature.id);
  if (!shape) {
    shape = featureShape(feature.path);
    shapeCache.set(feature.id, shape);
  }
  return shape;
}

export interface MapPilotMapProps {
  locale: Locale;
  copy: MapPilotCopy;
  /** The date on screen; undefined once the round is over. */
  current: MapPilotEvent | undefined;
  questionIndex: number;
  playableFeatures: Set<string>;
  roundFeatures: Set<string>;
  countryByFeature: Map<string, MapPilotCountry>;
  /** The committed answer for the date on screen. */
  selectedFeature: string | null;
  /** The committed answer, else the pending pick. */
  highlightFeature: string | null;
  onSelect: (featureId: string) => void;
}

export function MapPilotMap({
  locale,
  copy,
  current,
  questionIndex,
  playableFeatures,
  roundFeatures,
  countryByFeature,
  selectedFeature,
  highlightFeature,
  onSelect,
}: MapPilotMapProps) {
  const svg = useRef<SVGSVGElement>(null);
  const { box, narrow } = useMapBox(svg);
  const [zoomCenter, setZoomCenter] = useState<MapPoint | null>(null);
  // Zoom only helps where the list is a select: on wide screens the list
  // beside the map already reaches every country.
  const zoomable = narrow && box.width > 0 && current !== undefined;
  const zoomed = zoomable && zoomCenter !== null;
  const view = zoomed ? zoomedView(zoomCenter!, box) : WORLD_VIEW;
  const scale = fitScale(box, view);
  const pickable = current !== undefined && selectedFeature === null;

  // Every date starts from the whole map.
  useEffect(() => setZoomCenter(null), [questionIndex]);
  useEffect(() => {
    if (!zoomable) setZoomCenter(null);
  }, [zoomable]);
  // An answer whose country is out of the zoomed view shows on the whole map.
  useEffect(() => {
    if (!zoomed || selectedFeature === null || !current) return;
    const answer = mapPilotFeatures.find((feature) => feature.id === current.map_feature_id);
    if (answer && !viewContains(view, shapeOf(answer).anchor)) setZoomCenter(null);
  }, [selectedFeature]);

  function zoomAt(event: MouseEvent) {
    if (!zoomable || zoomed || !svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    setZoomCenter(clientToMap(
      { x: event.clientX, y: event.clientY },
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      WORLD_VIEW,
    ));
  }

  // On narrow screens a tap on the whole map zooms; it never selects.
  const zoomFirst = zoomable && !zoomed;
  const targetFeatures = scale > 0
    ? mapPilotFeatures.filter((feature) => (current ? playableFeatures : roundFeatures).has(feature.id))
    : [];

  return (
    <div class={`map-pilot-map-wrap${zoomed ? " is-zoomed" : ""}`}>
      <svg
        ref={svg}
        class={`map-pilot-world-map${zoomFirst ? " is-zoomable" : ""}`}
        viewBox={viewBoxValue(view)}
        role={current ? "group" : "img"}
        aria-label={current ? copy.mapLabel : copy.resultMapLabel}
        onClick={zoomAt}
      >
        {mapPilotFeatures.map((feature) => {
          if (!current) {
            // The finished round: the countries of its dates, not playable.
            return (
              <path
                key={feature.id}
                d={feature.path}
                class={`map-pilot-feature ${roundFeatures.has(feature.id) ? "is-answer" : ""}`}
                fill-rule="evenodd"
              />
            );
          }
          const isPlayable = playableFeatures.has(feature.id);
          const isSelected = highlightFeature === feature.id;
          const isCorrect = selectedFeature !== null && current.map_feature_id === feature.id;
          return (
            <path
              key={feature.id}
              d={feature.path}
              class={`map-pilot-feature ${isPlayable ? "is-playable" : ""} ${isPlayable && pickable ? "is-pickable" : ""} ${isSelected ? "is-selected" : ""} ${isCorrect ? "is-answer" : ""}`}
              fill-rule="evenodd"
              role={isPlayable ? "button" : undefined}
              // Preact writes SVG attributes as spelled, and SVG only reads the
              // lowercase names: tabIndex and fillRule did nothing, and Tab
              // skipped the map.
              tabindex={isPlayable && pickable ? 0 : -1}
              aria-label={isPlayable ? mapPilotCountryLabel(countryByFeature.get(feature.id)!, locale) : undefined}
              aria-pressed={isPlayable ? isSelected : undefined}
              // On the whole map of a narrow screen the click goes on to the SVG and zooms.
              onClick={isPlayable ? () => { if (!zoomFirst) onSelect(feature.id); } : undefined}
              onKeyDown={isPlayable ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(feature.id);
                }
              } : undefined}
            />
          );
        })}
        {targetFeatures.map((feature) => {
          const shape = shapeOf(feature);
          const size = Math.max(shape.width, shape.height) * scale;
          // Zoomed: a 44px target for every country, drawn only around the small ones.
          // Whole map: a dot drawn only on the countries too small to see.
          const radius = (zoomed ? TARGET_RADIUS_PX : DOT_RADIUS_PX) / scale;
          const isSelected = current !== undefined && highlightFeature === feature.id;
          const isCorrect = current
            ? selectedFeature !== null && current.map_feature_id === feature.id
            : true;
          const marked = size < (zoomed ? RING_BELOW_PX : DOT_BELOW_PX);
          // The path is the button for keyboards and screen readers; the
          // target only widens it for a finger or a mouse.
          const selects = pickable && !zoomFirst && (zoomed || marked);
          return (
            <circle
              key={`target-${feature.id}`}
              class={`map-pilot-target${marked ? " is-marked" : ""}${selects ? " is-pickable" : ""}${isSelected ? " is-selected" : ""}${isCorrect ? " is-answer" : ""}`}
              cx={shape.anchor.x}
              cy={shape.anchor.y}
              r={radius}
              aria-hidden="true"
              data-feature={feature.id}
              onClick={selects ? () => onSelect(feature.id) : undefined}
            />
          );
        })}
      </svg>
      {zoomFirst && pickable && <p class="map-pilot-zoom-hint" aria-hidden="true">{copy.zoomHint}</p>}
      {zoomed && (
        <button type="button" class="btn btn-secondary map-pilot-zoom-out" onClick={() => setZoomCenter(null)}>
          {copy.zoomOut}
        </button>
      )}
      <p class="map-pilot-attribution">{copy.mapCredit} {mapPilotMetadata.mapVersion} · {mapPilotMetadata.mapScale}</p>
    </div>
  );
}
