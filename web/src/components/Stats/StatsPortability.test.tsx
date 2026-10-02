import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsModal } from "./StatsModal";
import { StatsPortability } from "./StatsPortability";
import {
  PLAYER_STATS_STORAGE_KEY,
  createInitialPlayerStats,
  type PlayerStats,
} from "../../lib/player-stats";

function makeStats(played: number, won: number): PlayerStats {
  const base = createInitialPlayerStats();
  base.overall = { played, won, currentStreak: 1, maxStreak: 1 };
  base.games.quiz = { played, won, currentStreak: 1, maxStreak: 1 };
  return base;
}

function stubFileReader(content: string, failWith?: "onerror" | "onabort") {
  vi.stubGlobal(
    "FileReader",
    class {
      result: string | null = content;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsText(_file: unknown) {
        if (failWith === "onerror") this.onerror?.();
        else if (failWith === "onabort") this.onabort?.();
        else this.onload?.();
      }
    }
  );
}

function fileInput(container: Element): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input;
}

describe("StatsPortability", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("triggers a download of kpop-quiz-stats.json on export", async () => {
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(4, 4)));
    const createObjectURL = vi.fn((_blob: unknown) => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    let download: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      download = this.getAttribute("download");
    });

    render(<StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" />);
    fireEvent.click(screen.getByText("Exportar estatísticas"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toContain('"version": 1');
    expect(download).toBe("kpop-quiz-stats.json");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("imports valid stats, refreshes the modal, and announces success", async () => {
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(0, 0)));
    stubFileReader(JSON.stringify(makeStats(10, 8)));
    const { container } = render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" />
    );

    expect(screen.queryByText("80%")).not.toBeInTheDocument();
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["ignored"], "stats.json", { type: "application/json" })] },
    });

    await waitFor(() => expect(screen.getByText("80%")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Estatísticas importadas.");
    expect(JSON.parse(localStorage.getItem(PLAYER_STATS_STORAGE_KEY) || "{}").overall.played).toBe(10);
  });

  it("shows the catalog import error on invalid file", async () => {
    stubFileReader("not-json{{{");
    const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["x"], "bad.json", { type: "application/json" })] },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("O arquivo não está no formato esperado.")
    );
  });

  it.each(["onerror", "onabort"] as const)(
    "read failure (%s) announces the import error and resets the input",
    async (trigger) => {
      stubFileReader("x", trigger);
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
      fireEvent.change(fileInput(container), {
        target: { files: [new File(["x"], "s.json", { type: "application/json" })] },
      });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("O arquivo não está no formato esperado."));
      expect(fileInput(container).value).toBe("");
    }
  );

  it("keeps the previous metrics and storage on failed import through the full modal", async () => {
    const before = JSON.stringify(makeStats(10, 8));
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, before);
    stubFileReader("not-json{{{");
    const { container } = render(<StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["x"], "bad.json", { type: "application/json" })] },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("O arquivo não está no formato esperado."));
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBe(before);
  });

  it("shows the import error for an empty file", async () => {
    stubFileReader("");
    const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
    fireEvent.change(fileInput(container), { target: { files: [new File([], "e.json", { type: "application/json" })] } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("O arquivo não está no formato esperado."));
  });

  it("asks for inline confirmation and cancels the reset", () => {
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(5, 5)));
    const onStatsChange = vi.fn();
    render(<StatsPortability locale="pt-BR" onStatsChange={onStatsChange} />);

    fireEvent.click(screen.getByText("Apagar dados"));
    expect(
      screen.getByText("Tem certeza de que quer apagar as estatísticas?")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancelar"));
    expect(
      screen.queryByText("Tem certeza de que quer apagar as estatísticas?")
    ).not.toBeInTheDocument();
    expect(onStatsChange).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(PLAYER_STATS_STORAGE_KEY) || "{}").overall.played).toBe(5);
  });

  it("clears stats on confirm and announces in the aria-live region", async () => {
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(5, 5)));
    const { container } = render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" />
    );

    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Apagar dados"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(screen.queryByText("100%")).not.toBeInTheDocument());
    const live = container.querySelector('[aria-live="polite"][role="status"]');
    expect(live).toBeInTheDocument();
    expect(live).toHaveTextContent("Estatísticas apagadas.");
    expect(JSON.parse(localStorage.getItem(PLAYER_STATS_STORAGE_KEY) || "{}").overall.played).toBe(0);
  });

  it("renders correctly in English", () => {
    render(<StatsModal isOpen={true} onClose={vi.fn()} locale="en" stats={makeStats(2, 1)} />);

    expect(screen.getByText("Your stats")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close stats" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overall" })).toBeInTheDocument();
    expect(screen.getByText("Export stats")).toBeInTheDocument();
    expect(screen.getByText("Clear data")).toBeInTheDocument();
  });

  it("renders with zero violations in axe accessibility audit", async () => {
    const { container } = render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" stats={makeStats(10, 8)} />
    );

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
