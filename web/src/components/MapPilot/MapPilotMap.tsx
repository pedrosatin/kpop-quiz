import { useRef } from "preact/hooks";
import {
  mapPilotCountryLabel,
  mapPilotFeatures,
  mapPilotMetadata,
  type MapPilotCountry,
  type MapPilotEvent,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import type { MapPilotCopy } from "./map-pilot-copy";
import { viewBoxValue } from "./map-pilot-geometry";
import {
  classes,
  pathClass,
  pathState,
  shapeOf,
  targetClass,
  targetState,
  type MapPickContext,
  type PathState,
  type TargetContext,
} from "./map-pilot-targets";
import { useMapZoom } from "./useMapZoom";

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

type MapFeature = (typeof mapPilotFeatures)[number];

function MapFeaturePath({
  feature,
  state,
  label,
  onClick,
  onPick,
  onFocus,
}: {
  feature: MapFeature;
  state: PathState;
  label: string | undefined;
  onClick: (featureId: string, event: MouseEvent) => void;
  onPick: (featureId: string) => void;
  onFocus: (feature: MapFeature) => void;
}) {
  if (!state.playable) {
    return <path d={feature.path} class={pathClass(state)} fill-rule="evenodd" tabindex={-1} />;
  }
  return (
    <path
      d={feature.path}
      class={pathClass(state)}
      fill-rule="evenodd"
      role="button"
      tabindex={state.focusable ? 0 : -1}
      aria-label={label}
      aria-pressed={state.isSelected}
      onClick={(event) => onClick(feature.id, event)}
      onFocus={() => onFocus(feature)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPick(feature.id);
        }
      }}
    />
  );
}

function MapTarget({
  feature,
  ctx,
  onPick,
}: {
  feature: MapFeature;
  ctx: TargetContext;
  onPick: (featureId: string) => void;
}) {
  const shape = shapeOf(feature);
  const state = targetState(shape, feature.id, ctx);
  return (
    <circle
      class={targetClass(state)}
      cx={shape.anchor.x}
      cy={shape.anchor.y}
      r={state.radius}
      aria-hidden="true"
      data-feature={feature.id}
      onClick={state.selects ? () => onPick(feature.id) : undefined}
    />
  );
}

function MapOverlay({
  copy,
  hint,
  zoomed,
  onZoomOut,
}: {
  copy: MapPilotCopy;
  hint: boolean;
  zoomed: boolean;
  onZoomOut: () => void;
}) {
  return (
    <>
      {hint && <p class="map-pilot-zoom-hint" aria-hidden="true">{copy.zoomHint}</p>}
      {zoomed && (
        <div class="map-pilot-zoom-bar">
          <button type="button" class="btn btn-secondary map-pilot-zoom-out" onClick={onZoomOut}>
            {copy.zoomOut}
          </button>
        </div>
      )}
      <p class="map-pilot-attribution">{copy.mapCredit} {mapPilotMetadata.mapVersion} · {mapPilotMetadata.mapScale}</p>
    </>
  );
}

function PlayPaths({
  locale,
  playableFeatures,
  countryByFeature,
  ctx,
  onClick,
  onPick,
  onFocus,
}: {
  locale: Locale;
  playableFeatures: Set<string>;
  countryByFeature: Map<string, MapPilotCountry>;
  ctx: MapPickContext;
  onClick: (featureId: string, event: MouseEvent) => void;
  onPick: (featureId: string) => void;
  onFocus: (feature: MapFeature) => void;
}) {
  return (
    <>
      {mapPilotFeatures.map((feature) => {
        const playable = playableFeatures.has(feature.id);
        return (
          <MapFeaturePath
            key={feature.id}
            feature={feature}
            state={pathState(feature.id, playable, ctx)}
            label={playable ? mapPilotCountryLabel(countryByFeature.get(feature.id)!, locale) : undefined}
            onClick={onClick}
            onPick={onPick}
            onFocus={onFocus}
          />
        );
      })}
    </>
  );
}

function FinishedPaths({ roundFeatures }: { roundFeatures: Set<string> }) {
  return (
    <>
      {mapPilotFeatures.map((feature) => (
        <path
          key={feature.id}
          d={feature.path}
          class={classes("map-pilot-feature", roundFeatures.has(feature.id) && "is-answer")}
          fill-rule="evenodd"
        />
      ))}
    </>
  );
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
  const zoom = useMapZoom(svg, { current, questionIndex, selectedFeature });
  const ctx: MapPickContext = {
    selectedFeature,
    highlightFeature,
    answerFeature: current ? current.map_feature_id : null,
    pickable: current !== undefined && selectedFeature === null,
    pointerSelects: !zoom.zoomFirst,
  };
  const targetCtx: TargetContext = { ...ctx, finished: !current, zoomed: zoom.zoomed, scale: zoom.scale };
  const targetSet = current ? playableFeatures : roundFeatures;
  const targetFeatures = zoom.scale > 0 ? mapPilotFeatures.filter((feature) => targetSet.has(feature.id)) : [];

  function pickByPointer(featureId: string) {
    if (zoom.settled()) onSelect(featureId);
  }

  function pathClick(featureId: string, event: MouseEvent) {
    if (!(zoom.zoomFirst && zoom.isPointerClick(event))) pickByPointer(featureId);
  }

  function zoomOutToMap() {
    zoom.zoomOut();
    svg.current?.focus({ preventScroll: true });
  }

  return (
    <div class={classes("map-pilot-map-wrap", zoom.zoomed && "is-zoomed")}>
      <svg
        ref={svg}
        class={classes("map-pilot-world-map", zoom.zoomFirst && "is-zoomable")}
        viewBox={viewBoxValue(zoom.view)}
        role={current ? "group" : "img"}
        aria-label={current ? copy.mapLabel : copy.resultMapLabel}
        tabindex={current ? -1 : undefined}
        onClick={zoom.zoomAt}
        {...zoom.pointerHandlers}
      >
        {current
          ? (
            <PlayPaths
              locale={locale}
              playableFeatures={playableFeatures}
              countryByFeature={countryByFeature}
              ctx={ctx}
              onClick={pathClick}
              onPick={onSelect}
              onFocus={zoom.revealFocused}
            />
          )
          : <FinishedPaths roundFeatures={roundFeatures} />}
        {targetFeatures.map((feature) => (
          <MapTarget key={`target-${feature.id}`} feature={feature} ctx={targetCtx} onPick={pickByPointer} />
        ))}
      </svg>
      <MapOverlay copy={copy} hint={zoom.zoomFirst && ctx.pickable} zoomed={zoom.zoomed} onZoomOut={zoomOutToMap} />
    </div>
  );
}
