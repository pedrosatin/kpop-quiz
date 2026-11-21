import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isIntersectionGrid } from "../lib/quiz-types";
import { isGridPublication } from "../data/grid-publication";

const fixedDir = join(import.meta.dirname, "../../e2e/fixtures/fixed-data");

describe("frozen E2E daily artifacts", () => {
  it("grid.daily.json passes the real intersection-grid loader guard", () => {
    const grid = JSON.parse(readFileSync(join(fixedDir, "grid.daily.json"), "utf8"));
    expect(isIntersectionGrid(grid)).toBe(true);
    expect(grid.reference_date).toBe("2026-09-17");
  });

  it("a corrected-day publication for that board passes the publication guard", () => {
    const grid = JSON.parse(readFileSync(join(fixedDir, "grid.daily.json"), "utf8"));
    const publication = {
      schema_version: "kpop-grid-publication-v1",
      reference_date: grid.reference_date,
      grid_id: grid.grid_id,
      grid_reference_date: grid.reference_date,
      replaces: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    };
    expect(isGridPublication(publication)).toBe(true);
  });
});
