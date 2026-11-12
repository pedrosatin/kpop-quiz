/*
  What each country of the map looks like and does, as pure functions of the
  turn and the view: the path of every country and the round target drawn
  over the countries of the round (see map-pilot-geometry.ts for the sizes).
*/
import {
  DOT_BELOW_PX,
  DOT_RADIUS_PX,
  featureShape,
  RING_BELOW_PX,
  TARGET_RADIUS_PX,
  type FeatureShape,
} from "./map-pilot-geometry";

/** Joins the class names that apply. */
export function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

const shapeCache = new Map<string, FeatureShape>();

/** Shapes are read only for the features that need one, once per page. */
export function shapeOf(feature: { id: string; path: string }): FeatureShape {
  let shape = shapeCache.get(feature.id);
  if (!shape) {
    shape = featureShape(feature.path);
    shapeCache.set(feature.id, shape);
  }
  return shape;
}

export interface MapMarkContext {
  /** The committed answer for the date on screen. */
  selectedFeature: string | null;
  /** The committed answer, else the pending pick. */
  highlightFeature: string | null;
  /** The correct country of the date on screen. */
  answerFeature: string | null;
}

export interface FeatureMarks {
  isSelected: boolean;
  isCorrect: boolean;
  /** The answer sent, when it is not the correct country. */
  isWrong: boolean;
}

export function featureMarks(featureId: string, ctx: MapMarkContext): FeatureMarks {
  const answered = ctx.selectedFeature !== null;
  const isSelected = ctx.highlightFeature === featureId;
  const isCorrect = answered && ctx.answerFeature === featureId;
  return { isSelected, isCorrect, isWrong: answered && isSelected && !isCorrect };
}

export interface MapPickContext extends MapMarkContext {
  /** The date on screen still takes a pick. */
  pickable: boolean;
  /** A tap or a click selects; false while the first tap only zooms. */
  pointerSelects: boolean;
}

export interface PathState extends FeatureMarks {
  playable: boolean;
  /** In the Tab order: Enter or Space selects it. */
  focusable: boolean;
  /** A tap or a click selects it. */
  pointerPick: boolean;
}

export function pathState(featureId: string, playable: boolean, ctx: MapPickContext): PathState {
  const focusable = playable && ctx.pickable;
  return {
    playable,
    focusable,
    pointerPick: focusable && ctx.pointerSelects,
    ...featureMarks(featureId, ctx),
  };
}

export function pathClass(state: PathState): string {
  return classes(
    "map-pilot-feature",
    state.playable && "is-playable",
    state.focusable && "is-focusable",
    state.pointerPick && "is-pickable",
    state.isSelected && "is-selected",
    state.isWrong && "is-wrong",
    state.isCorrect && "is-answer",
  );
}

export interface TargetContext extends MapPickContext {
  /** The round is over: the targets mark the countries of its dates. */
  finished: boolean;
  zoomed: boolean;
  /** Screen pixels per map unit. */
  scale: number;
}

export interface TargetState extends FeatureMarks {
  /** In map units. */
  radius: number;
  /** Drawn: the country is too small to see or to hit on its own. */
  marked: boolean;
  /** A tap or a click on the target selects the country. */
  selects: boolean;
}

const FINISHED_MARKS: FeatureMarks = { isSelected: false, isCorrect: true, isWrong: false };

/**
 * Zoomed: a 44px target for every country, drawn only around the small ones.
 * Whole map: a dot drawn only on the countries too small to see. The path is
 * the button for keyboards and screen readers; the target only widens it for
 * a finger or a mouse.
 */
export function targetState(shape: FeatureShape, featureId: string, ctx: TargetContext): TargetState {
  const size = Math.max(shape.width, shape.height) * ctx.scale;
  const marked = size < (ctx.zoomed ? RING_BELOW_PX : DOT_BELOW_PX);
  return {
    radius: (ctx.zoomed ? TARGET_RADIUS_PX : DOT_RADIUS_PX) / ctx.scale,
    marked,
    selects: ctx.pickable && ctx.pointerSelects && (ctx.zoomed || marked),
    ...(ctx.finished ? FINISHED_MARKS : featureMarks(featureId, ctx)),
  };
}

export function targetClass(state: TargetState): string {
  return classes(
    "map-pilot-target",
    state.marked && "is-marked",
    state.selects && "is-pickable",
    state.isSelected && "is-selected",
    state.isWrong && "is-wrong",
    state.isCorrect && "is-answer",
  );
}
