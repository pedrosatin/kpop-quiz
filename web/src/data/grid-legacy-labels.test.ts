import { describe, expect, it } from "vitest";
import { formedCriterionLabel, withCurrentFormationLabels } from "./grid-legacy-labels";
import type { GridCriterion, IntersectionGrid } from "../lib/quiz-types";
import current from "../tests/fixtures/grid.daily.json";
import publishedMain from "../tests/fixtures/grid.published-legacy-20261026.json";
import publishedNext from "../tests/fixtures/grid.published-legacy-20261027.json";

const grid = (value: unknown) => value as IntersectionGrid;
const criterion = (over: Partial<GridCriterion>): GridCriterion => ({
  id: "formed_2010s",
  category: "formed_on",
  label: { "pt-BR": "Estreou nos anos 2010", en: "Debuted in the 2010s" },
  ...over,
});

describe("legacy decade labels of published grids", () => {
  it.each([1990, 2000, 2010, 2020])("rewords the %is pair in both locales", (year) => {
    const label = formedCriterionLabel(criterion({
      id: `formed_${year}s`,
      label: { "pt-BR": `Estreou nos anos ${year}`, en: `Debuted in the ${year}s` },
    }));
    expect(label).toEqual({ "pt-BR": `Formado nos anos ${year}`, en: `Formed in the ${year}s` });
  });

  it("recognizes the axis ids of early artifacts", () => {
    for (const id of ["row_formed_2010s", "col_formed_2010s"]) {
      expect(formedCriterionLabel(criterion({ id })).en).toBe("Formed in the 2010s");
    }
  });

  it("keeps a label that already says Formado/Formed", () => {
    const published = criterion({ label: { "pt-BR": "Formado nos anos 2010", en: "Formed in the 2010s" } });
    expect(formedCriterionLabel(published)).toBe(published.label);
  });

  it.each([
    ["another category", { category: "record_label" as const }],
    ["an id that is not a decade", { id: "formed_recent" }],
    ["an id with another prefix", { id: "debut_2010s" }],
    ["a decade outside the table", { id: "formed_1980s", label: { "pt-BR": "Estreou nos anos 1980", en: "Debuted in the 1980s" } }],
    ["a legacy label of another decade", { label: { "pt-BR": "Estreou nos anos 2000", en: "Debuted in the 2000s" } }],
    ["a generic label", { label: { "pt-BR": "Anos 2010", en: "The 2010s" } }],
    ["only the pt-BR half", { label: { "pt-BR": "Estreou nos anos 2010", en: "Active in the 2010s" } }],
    ["only the en half", { label: { "pt-BR": "Ativo nos anos 2010", en: "Debuted in the 2010s" } }],
    ["a label that differs in case", { label: { "pt-BR": "estreou nos anos 2010", en: "Debuted in the 2010s" } }],
  ])("leaves %s as published", (_name, over) => {
    const published = criterion(over);
    expect(formedCriterionLabel(published)).toBe(published.label);
  });

  it("never rewords a debut-worded label of a criterion that is not formed_on", () => {
    // A debut axis would have its own category; the wording alone proves nothing.
    const debut = criterion({ category: "record_label", id: "label_x" });
    expect(formedCriterionLabel(debut)).toBe(debut.label);
  });

  describe("real artifacts published before the wording changed", () => {
    it("rewords only the decade axes of the 2026-10-26 grid (columns)", () => {
      const shown = withCurrentFormationLabels(grid(publishedMain));
      expect(shown.col_criteria.map((c) => c.label["pt-BR"])).toEqual([
        "Formado nos anos 2000",
        "Formado nos anos 2010",
        "5 ou menos integrantes",
      ]);
      expect(shown.col_criteria.map((c) => c.label.en)).toEqual([
        "Formed in the 2000s",
        "Formed in the 2010s",
        "5 or fewer members",
      ]);
      expect(shown.row_criteria).toBe(publishedMain.row_criteria);
    });

    it("rewords the decade axis of the 2026-10-27 grid and keeps the other two", () => {
      const shown = withCurrentFormationLabels(grid(publishedNext));
      expect(shown.col_criteria.map((c) => c.label["pt-BR"])).toEqual([
        "6 ou mais integrantes",
        "4 ou menos integrantes",
        "Formado nos anos 2010",
      ]);
      expect(shown.col_criteria[0]).toBe(publishedNext.col_criteria[0]);
    });

    it.each([publishedMain, publishedNext])("keeps identity, ids, categories, cells and pool", (artifact) => {
      const before = structuredClone(artifact);
      const shown = withCurrentFormationLabels(grid(artifact));
      expect(artifact).toEqual(before); // the published object is not mutated
      expect(shown.grid_id).toBe(artifact.grid_id);
      expect(shown.dataset_version).toBe(artifact.dataset_version);
      expect(shown.reference_date).toBe(artifact.reference_date);
      expect(shown.cells).toBe(artifact.cells);
      expect(shown.candidate_pool).toBe(artifact.candidate_pool);
      for (const axis of ["row_criteria", "col_criteria"] as const) {
        expect(shown[axis].map(({ id, category }) => [id, category]))
          .toEqual(artifact[axis].map(({ id, category }) => [id, category]));
      }
      expect(Object.keys(shown).sort()).toEqual(Object.keys(artifact).sort());
    });
  });

  it("returns a grid with the current wording untouched", () => {
    expect(withCurrentFormationLabels(grid(current))).toBe(current);
  });
});
