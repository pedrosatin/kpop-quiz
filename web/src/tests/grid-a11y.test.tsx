import { cleanup, render } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridBoard } from "../components/Grid/GridBoard";
import { GridCell } from "../components/Grid/GridCell";
import { EntityPicker } from "../components/Grid/EntityPicker";
import { GridResults } from "../components/Grid/GridResults";
import { GridReview } from "../components/Grid/GridReview";
import { IntersectionGrid } from "../components/Grid/IntersectionGrid";
import { getMessages } from "../i18n/catalog";
import type { IntersectionGrid as IntersectionGridType } from "../lib/quiz-types";
import validGridJson from "./fixtures/grid.daily.json";
import { cellKey, type GridCellState } from "../components/Grid/types";

const ptMessages = getMessages("pt-BR");
const validGrid = validGridJson as unknown as IntersectionGridType;

function sampleCellStates(): Record<string, GridCellState> {
  const states: Record<string, GridCellState> = {};
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      states[cellKey(r, c)] = { solved: false, failed: false };
    }
  }
  // Cell (0, 0) solved
  states[cellKey(0, 0)] = {
    solved: true,
    failed: false,
    entityId: "Q21461452",
    entityName: "TWICE",
  };
  // Cell (0, 1) failed
  states[cellKey(0, 1)] = {
    solved: false,
    failed: true,
    lastAttempt: "SHINee",
  };
  return states;
}

describe("Automated accessibility audits with axe-core for Intersection Grid", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates GridBoard with criteria headers and mixed cell states", async () => {
    const { container } = render(
      <GridBoard
        grid={validGrid}
        cellStates={sampleCellStates()}
        selectedCell={{ row: 1, col: 1 }}
        onSelectCell={vi.fn()}
        disabled={false}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates GridCell in empty state", async () => {
    const { container } = render(
      <GridCell
        row={1}
        col={1}
        rowCriterion={validGrid.row_criteria[1]!}
        colCriterion={validGrid.col_criteria[1]!}
        cellState={{ solved: false, failed: false }}
        isSelected={false}
        disabled={false}
        onSelect={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates GridCell in solved state", async () => {
    const { container } = render(
      <GridCell
        row={0}
        col={0}
        rowCriterion={validGrid.row_criteria[0]!}
        colCriterion={validGrid.col_criteria[0]!}
        cellState={{ solved: true, failed: false, entityName: "TWICE" }}
        isSelected={false}
        disabled={false}
        onSelect={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates GridCell in failed state", async () => {
    const { container } = render(
      <GridCell
        row={0}
        col={1}
        rowCriterion={validGrid.row_criteria[0]!}
        colCriterion={validGrid.col_criteria[1]!}
        cellState={{ solved: false, failed: true, lastAttempt: "SHINee" }}
        isSelected={false}
        disabled={false}
        onSelect={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates EntityPicker dialog with search and candidates", async () => {
    const { container } = render(
      <EntityPicker
        candidatePool={validGrid.candidate_pool}
        usedEntityIds={new Set(["Q21461452"])}
        rowLabel="Estreou nos anos 2010"
        colLabel="JYP Entertainment"
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates EntityPicker dialog with uniqueness error alert", async () => {
    const { container } = render(
      <EntityPicker
        candidatePool={validGrid.candidate_pool}
        usedEntityIds={new Set(["Q21461452"])}
        uniquenessError="TWICE"
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates GridResults completion screen with matrix and actions", async () => {
    const { container } = render(
      <GridResults
        grid={validGrid}
        cellStates={sampleCellStates()}
        guessesUsed={5}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates GridReview evidence section", async () => {
    const { container } = render(
      <GridReview
        grid={validGrid}
        cellStates={sampleCellStates()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates IntersectionGrid orchestrator in ready state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(validGridJson)))
    );

    const { container, findByRole } = render(
      <IntersectionGrid locale="pt-BR" messages={ptMessages} />
    );

    await findByRole("grid");
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
