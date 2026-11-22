
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
