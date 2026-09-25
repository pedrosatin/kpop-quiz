import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridResults } from "./GridResults";
import { getMessages } from "../../i18n/catalog";
import type { IntersectionGrid } from "../../lib/quiz-types";
import validGridJson from "../../tests/fixtures/grid.daily.json";
import { cellKey, type GridCellState } from "./types";

const ptMessages = getMessages("pt-BR");
const validGrid = validGridJson as unknown as IntersectionGrid;

function sampleCellStates(solvedIndexes: [number, number][] = []): Record<string, GridCellState> {
  const states: Record<string, GridCellState> = {};
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      states[cellKey(r, c)] = { solved: false, failed: false };
    }
  }
  for (const [r, c] of solvedIndexes) {
    states[cellKey(r, c)] = {
      solved: true,
      failed: false,
      entityId: "Q21461452",
      entityName: "TWICE",
    };
  }
  return states;
}

describe("GridResults component", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders completion header, summary, and share matrix", () => {
    const states = sampleCellStates([[0, 0], [1, 1]]);
    render(
      <GridResults
        grid={validGrid}
        cellStates={states}
        guessesUsed={5}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    expect(screen.getByText("Fim da partida")).toBeInTheDocument();
    expect(screen.getByText("2 de 9 casas certas com 5 palpites")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Resultado da grade" })).toBeInTheDocument();
  });

  it("toggles high-contrast monochrome symbols (■ and □)", () => {
    const states = sampleCellStates([[0, 0]]);
    render(
      <GridResults
        grid={validGrid}
        cellStates={states}
        guessesUsed={1}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const matrix = screen.getByRole("img", { name: "Resultado da grade" });
    expect(matrix.textContent).toContain("🟩");

    const checkbox = screen.getByRole("checkbox", { name: /alto contraste/i });
    fireEvent.click(checkbox);

    expect(matrix.textContent).toContain("■");
    expect(matrix.textContent).toContain("□");
  });

  it("copies share text to clipboard and shows feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    const states = sampleCellStates([[0, 0]]);
    render(
      <GridResults
        grid={validGrid}
        cellStates={states}
        guessesUsed={3}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const copyBtn = screen.getByRole("button", { name: "Copiar resultado" });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedContent = writeText.mock.calls[0]![0] as string;
    expect(copiedContent).toContain("K-pop Grid 2026-09-17");
    expect(copiedContent).toContain("1/9 acertos (3 palpites)");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Resultado copiado.");
    });
  });

  it("invokes navigator.share when supported", () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: shareMock,
    });

    const states = sampleCellStates([[0, 0]]);
    render(
      <GridResults
        grid={validGrid}
        cellStates={states}
        guessesUsed={1}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    fireEvent.click(shareBtn);

    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Grade de interseções",
        text: expect.stringContaining("K-pop Grid 2026-09-17"),
      })
    );
  });

  it("renders factual review with accepted answers and evidence links", () => {
    const states = sampleCellStates([[0, 0]]);
    render(
      <GridResults
        grid={validGrid}
        cellStates={states}
        guessesUsed={1}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    expect(screen.getByText("Respostas e fontes")).toBeInTheDocument();
    expect(screen.getByText("Linha 1, coluna 1")).toBeInTheDocument();

    const evidenceLinks = screen.getAllByRole("link");
    expect(evidenceLinks.length).toBeGreaterThan(0);
    for (const link of evidenceLinks) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("calls onRestart when restart button is clicked", () => {
    const onRestart = vi.fn();
    render(
      <GridResults
        grid={validGrid}
        cellStates={sampleCellStates()}
        guessesUsed={9}
        onRestart={onRestart}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const restartBtn = screen.getByRole("button", { name: "Jogar novamente" });
    fireEvent.click(restartBtn);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
