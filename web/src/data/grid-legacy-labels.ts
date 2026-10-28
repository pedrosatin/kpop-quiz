/**
 * Display text of decade criteria in grids published before the label said
 * "Formado/Formed".
 *
 * The decade axes have always been computed from `formed_on` facts (Wikidata
 * P571); the first generator already filtered on that predicate. Early
 * artifacts only worded the label as a debut ("Estreou nos anos 2010").
 * The fallback copies the previous grid byte for byte, so such a grid can
 * still be served under the "Formação" tag.
 *
 * A criterion is reworded only when all of these hold: its category is
 * `formed_on`, its id names a decade, and both locale labels read exactly as
 * the legacy pair of that same decade. Anything else is shown as published.
 * Only the label text of the in-memory copy changes: `grid_id`, criterion
 * ids, categories, cells and the saved game (keyed by `grid_id`, holding
 * entity ids only) stay as published.
 */

import type { GridCriterion, IntersectionGrid } from "../lib/quiz-types";

interface DecadeWording {
  legacy: GridCriterion["label"];
  current: GridCriterion["label"];
}

function decade(year: number): [string, DecadeWording] {
  return [
    `${year}s`,
    {
      legacy: { "pt-BR": `Estreou nos anos ${year}`, en: `Debuted in the ${year}s` },
      current: { "pt-BR": `Formado nos anos ${year}`, en: `Formed in the ${year}s` },
    },
  ];
}

const DECADES = new Map<string, DecadeWording>([1990, 2000, 2010, 2020].map(decade));

/** `formed_2010s`, or `row_formed_2010s` / `col_formed_2010s` of early fixtures. */
const DECADE_ID = /^(?:(?:row|col)_)?formed_(\d{4}s)$/;

export function formedCriterionLabel(criterion: GridCriterion): GridCriterion["label"] {
  if (criterion.category !== "formed_on") return criterion.label;
  const wording = DECADES.get(DECADE_ID.exec(criterion.id)?.[1] ?? "");
  if (!wording) return criterion.label;
  const { label } = criterion;
  if (label["pt-BR"] !== wording.legacy["pt-BR"] || label.en !== wording.legacy.en) return criterion.label;
  return wording.current;
}

function relabelAxis(axis: GridCriterion[]): GridCriterion[] {
  let changed = false;
  const next = axis.map((criterion) => {
    const label = formedCriterionLabel(criterion);
    if (label === criterion.label) return criterion;
    changed = true;
    return { ...criterion, label };
  });
  return changed ? next : axis;
}

/** The grid as shown to the player; the input is not modified. */
export function withCurrentFormationLabels<T extends IntersectionGrid>(grid: T): T {
  const row_criteria = relabelAxis(grid.row_criteria);
  const col_criteria = relabelAxis(grid.col_criteria);
  if (row_criteria === grid.row_criteria && col_criteria === grid.col_criteria) return grid;
  return { ...grid, row_criteria, col_criteria };
}
