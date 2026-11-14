import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
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

function pickFile(container: Element) {
  fireEvent.change(fileInput(container), {
    target: { files: [new File(["ignored"], "stats.json", { type: "application/json" })] },
  });
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

  it("imports valid stats after confirmation, refreshes the modal, and announces success", async () => {
    localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(1, 0)));
    stubFileReader(JSON.stringify(makeStats(10, 8)));
    const { container } = render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" />
    );

    expect(screen.queryByText("80%")).not.toBeInTheDocument();
    pickFile(container);

    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Substituir estatísticas" }));

    await waitFor(() => expect(screen.getByText("80%")).toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Estatísticas importadas.");
    expect(JSON.parse(localStorage.getItem(PLAYER_STATS_STORAGE_KEY) || "{}").overall.played).toBe(10);
    expect(screen.getByRole("button", { name: "Importar estatísticas" })).toHaveFocus();
  });

  describe("import confirmation", () => {
    function exported(stats: PlayerStats, exportedAt?: unknown): string {
      return JSON.stringify(exportedAt === undefined ? stats : { ...stats, exportedAt });
    }

    function fileStats(): PlayerStats {
      const stats = makeStats(10, 8);
      stats.overall = { played: 10, won: 8, currentStreak: 2, maxStreak: 4, lastPlayedDate: "2026-10-01" };
      return stats;
    }

    function rowCells(confirm: HTMLElement, label: string): string[] {
      const header = within(confirm).getByRole("rowheader", { name: label });
      return Array.from(header.closest("tr")!.querySelectorAll("td")).map((cell) => cell.textContent ?? "");
    }

    it("shows the export date and the file totals next to the local ones, with Cancel focused", async () => {
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(3, 1)));
      // Noon UTC is October 1 in every time zone from UTC-11 to UTC+11.
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
      pickFile(container);

      const confirm = await screen.findByRole("alertdialog", {
        name: "Substituir as estatísticas deste aparelho pelas do arquivo?",
      });
      expect(confirm).toHaveAccessibleDescription(/^Arquivo exportado em 1 de outubro de 2026/);
      expect(confirm).toHaveAccessibleDescription(/O que estiver só neste aparelho será perdido/);
      expect(within(confirm).getByRole("columnheader", { name: "Neste aparelho" })).toBeInTheDocument();
      expect(within(confirm).getByRole("columnheader", { name: "No arquivo" })).toBeInTheDocument();
      expect(rowCells(confirm, "Partidas")).toEqual(["3", "10"]);
      expect(rowCells(confirm, "Vitórias")).toEqual(["1", "8"]);
      expect(rowCells(confirm, "Sequência atual")).toEqual(["1", "2"]);
      expect(rowCells(confirm, "Maior sequência")).toEqual(["1", "4"]);
      expect(rowCells(confirm, "Último desafio diário")).toEqual(["Nenhum", "1 de out. de 2026"]);
      await waitFor(() => expect(within(confirm).getByRole("button", { name: "Cancelar" })).toHaveFocus());
      expect(screen.getByRole("button", { name: "Importar estatísticas" })).toHaveAttribute("aria-expanded", "true");
    });

    it("leaves local storage untouched until the player confirms", async () => {
      const before = JSON.stringify(makeStats(3, 1));
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, before);
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const onStatsChange = vi.fn();
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={onStatsChange} />);
      pickFile(container);

      await screen.findByRole("alertdialog");
      expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBe(before);
      expect(onStatsChange).not.toHaveBeenCalled();
    });

    it("cancel keeps local storage intact and gives focus back to Import", async () => {
      const before = JSON.stringify(makeStats(3, 1));
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, before);
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const onStatsChange = vi.fn();
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={onStatsChange} />);
      pickFile(container);

      const confirm = await screen.findByRole("alertdialog");
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBe(before);
      expect(onStatsChange).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("");
      expect(screen.getByRole("button", { name: "Importar estatísticas" })).toHaveFocus();
    });

    it("Escape cancels the confirmation without closing the stats window", async () => {
      const before = JSON.stringify(makeStats(3, 1));
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, before);
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const onClose = vi.fn();
      const { container } = render(<StatsModal isOpen={true} onClose={onClose} locale="pt-BR" />);
      pickFile(container);

      const confirm = await screen.findByRole("alertdialog");
      const cancel = within(confirm).getByRole("button", { name: "Cancelar" });
      await waitFor(() => expect(cancel).toHaveFocus());
      fireEvent.keyDown(cancel, { key: "Escape" });

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBe(before);
      expect(screen.getByRole("button", { name: "Importar estatísticas" })).toHaveFocus();
    });

    it("says the export date is unknown for a file from before exportedAt", async () => {
      stubFileReader(exported(fileStats()));
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
      pickFile(container);

      const confirm = await screen.findByRole("alertdialog");
      expect(confirm).toHaveAccessibleDescription(/^O arquivo não informa quando foi exportado\./);
      fireEvent.click(within(confirm).getByRole("button", { name: "Substituir estatísticas" }));
      expect(JSON.parse(localStorage.getItem(PLAYER_STATS_STORAGE_KEY) || "{}").overall.played).toBe(10);
    });

    it("treats an exportedAt that is not a date as unknown", async () => {
      stubFileReader(exported(fileStats(), "yesterday"));
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
      pickFile(container);

      const confirm = await screen.findByRole("alertdialog");
      expect(confirm).toHaveAccessibleDescription(/^O arquivo não informa quando foi exportado\./);
    });

    it("renders the confirmation in English", async () => {
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(3, 1)));
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const { container } = render(<StatsPortability locale="en" onStatsChange={vi.fn()} />);
      pickFile(container);

      const confirm = await screen.findByRole("alertdialog", {
        name: "Replace the stats on this device with the ones in the file?",
      });
      expect(confirm).toHaveAccessibleDescription(/^File exported on October 1, 2026/);
      expect(confirm).toHaveAccessibleDescription(/Anything that is only on this device will be lost/);
      expect(rowCells(confirm, "Played")).toEqual(["3", "10"]);
      expect(rowCells(confirm, "Wins")).toEqual(["1", "8"]);
      expect(rowCells(confirm, "Last daily challenge")).toEqual(["None", "Oct 1, 2026"]);
      expect(within(confirm).getByRole("columnheader", { name: "On this device" })).toBeInTheDocument();
      expect(within(confirm).getByRole("columnheader", { name: "In the file" })).toBeInTheDocument();
      expect(within(confirm).getByRole("button", { name: "Replace stats" })).toBeInTheDocument();
      expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("rejects a file with a future date without asking", async () => {
      const before = JSON.stringify(makeStats(3, 1));
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, before);
      const stats = fileStats();
      stats.overall.lastPlayedDate = "9999-12-31";
      stubFileReader(exported(stats, "2026-10-01T12:00:00.000Z"));
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
      pickFile(container);

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("O arquivo não está no formato esperado.")
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBe(before);
    });

    it("opening the reset confirmation drops a pending import", async () => {
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const { container } = render(<StatsPortability locale="pt-BR" onStatsChange={vi.fn()} />);
      pickFile(container);
      await screen.findByRole("alertdialog");

      fireEvent.click(screen.getByText("Apagar dados"));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByText("Tem certeza de que quer apagar as estatísticas?")).toBeInTheDocument();
    });

    it("has zero axe violations with the confirmation open", async () => {
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify(makeStats(3, 1)));
      stubFileReader(exported(fileStats(), "2026-10-01T12:00:00.000Z"));
      const { container } = render(<StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" />);
      pickFile(container);
      await screen.findByRole("alertdialog");

      const results = await axe.run(container);
      expect(results.violations).toEqual([]);
    });
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
