import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../../public/data/code-groups.pilot.json";
import { getMessages } from "../../i18n/catalog";
import { loadPlayerStats, markGameMatchRecorded } from "../../lib/player-stats";
import { CodeGroupsGame } from "./CodeGroupsGame";
import { generateShareText } from "./CodeGroupsGameContent";
import { RESULT_GUARD_MS } from "../Results/use-result-action-guard";
import type { CodeGroupsPuzzle } from "../../data/code-groups";

// The committed pilot artifact is the fixed example and carries a valid
// identity hash, so it doubles as the frozen fixture of these tests.
const puzzle = validPuzzleJson as unknown as CodeGroupsPuzzle;
const pt = getMessages("pt-BR");
const STORAGE_KEY = `kpop-code-${puzzle.reference_date}`;

// The result buttons ignore activation for a moment after they appear; tests
// advance a mocked clock past the guard before pressing them.
let clock = 1000;

function renderGame(locale: "pt-BR" | "en" = "pt-BR") {
  return render(<CodeGroupsGame locale={locale} />);
}

function selectSlot(index: number, qid: string) {
  fireEvent.change(screen.getAllByRole("combobox")[index]!, {
    target: { value: qid },
  });
}

function guess(ids: string[]) {
  ids.forEach((id, index) => selectSlot(index, id));
  fireEvent.click(screen.getByRole("button", { name: pt.codeSubmit }));
}

async function settle() {
  // Lets the effects an async artifact load schedules run (jsdom rAF).
  await new Promise((resolve) => setTimeout(resolve, 50));
  await act(async () => {});
}

describe("CodeGroupsGame", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads the daily artifact and renders six symbols in the slots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    expect(await screen.findAllByRole("combobox")).toHaveLength(4);
    const options = screen.getAllByRole("option");
    // The six symbols offered in every one of the four slots.
    expect(options.filter((option) => (option as HTMLOptionElement).value !== "")).toHaveLength(24);
    expect(screen.getByText(pt.codeSequenceNote)).toBeInTheDocument();
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("10");
  });

  it("accepts a correct guess, records the stats once and shows the cited result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(puzzle)))));
    renderGame();
    await screen.findAllByRole("combobox");
    guess(puzzle.secret as string[]);

    expect(screen.getByRole("heading", { level: 2, name: pt.codeResultWon })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("game-result"));
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("1");
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(loadPlayerStats().games.code?.played).toBe(1);

    // A reload of the finished game must not replay the stats.
    cleanup();
    renderGame();
    await screen.findByRole("heading", { level: 2, name: pt.codeResultWon });
    await settle();
    expect(loadPlayerStats().games.code?.played).toBe(1);
    // A restored result does not move focus.
    expect(document.activeElement).toBe(document.body);
  });

  it("counts exact and misplaced groups like the generator does", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    await screen.findAllByRole("combobox");
    guess([puzzle.secret[1]!, puzzle.secret[0]!, puzzle.secret[2]!, puzzle.secret[3]!]);
    expect(screen.getByText(pt.codeGuessSummary(2, 2))).toBeInTheDocument();

    const unused = puzzle.symbols.map((s) => s.qid).filter((id) => !puzzle.secret.includes(id));
    guess([unused[0]!, unused[1]!, puzzle.secret[0]!, puzzle.secret[1]!]);
    expect(screen.getByText(pt.codeGuessSummary(0, 2))).toBeInTheDocument();
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("8");
  });

  it("rejects an incomplete or repeated selection without spending an attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    await screen.findAllByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: pt.codeSubmit }));
    expect(screen.getByText(pt.codeChooseAll)).toBeInTheDocument();
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("10");

    guess([puzzle.secret[0]!, puzzle.secret[0]!, puzzle.secret[1]!, puzzle.secret[2]!]);
    expect(screen.getByText(pt.codeChooseDistinct)).toBeInTheDocument();
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("10");
    expect(document.querySelectorAll(".code-history li")).toHaveLength(0);
  });

  it("offers a working retry when the artifact is missing or invalid", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(new Response(JSON.stringify({ ...puzzle, mode: "daily" })));
        }
        return Promise.resolve(new Response(JSON.stringify(puzzle)));
      }),
    );
    renderGame();
    expect(await screen.findByTestId("game-missing")).toHaveTextContent(pt.loadError);
    fireEvent.click(screen.getByTestId("game-retry"));
    expect(await screen.findAllByRole("combobox")).toHaveLength(4);
  });

  it("keeps the missing copy for a day without the artifact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    renderGame();
    expect(await screen.findByTestId("game-missing")).toHaveTextContent(pt.codeArtifactMissing);
  });

  it("resumes progress saved under kpop-code-<date>", async () => {
    const played = puzzle.secret.slice(1).concat(puzzle.secret.slice(0, 1));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ history: [played], selection: ["", "", "", ""] }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    expect(await screen.findByText(pt.codeGuessSummary(0, 4))).toBeInTheDocument();
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("9");
    // The resumed board is playable and finishing it works.
    guess(puzzle.secret as string[]);
    expect(screen.getByRole("heading", { level: 2, name: pt.codeResultWon })).toBeInTheDocument();
  });

  it("drops a save with a group outside the symbols or an impossible shape", async () => {
    const bogus = puzzle.secret.slice(1).concat("Q999999");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ history: [bogus], selection: ["", "", "", ""] }));
    localStorage.setItem("kpop-code-2020-01-01", JSON.stringify({ history: [], selection: ["", "", "", ""] }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    await screen.findAllByRole("combobox");
    expect(document.querySelectorAll(".code-history li")).toHaveLength(0);
    // The save of another day was pruned.
    expect(localStorage.getItem("kpop-code-2020-01-01")).toBeNull();
  });

  it("records a restored finished game exactly once", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ history: [puzzle.secret], selection: ["", "", "", ""] }),
    );
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(puzzle)))));
    renderGame();
    await screen.findByRole("heading", { level: 2, name: pt.codeResultWon });
    await settle();
    expect(loadPlayerStats().games.code?.played).toBe(1);

    cleanup();
    renderGame();
    await screen.findByRole("heading", { level: 2, name: pt.codeResultWon });
    await settle();
    expect(loadPlayerStats().games.code?.played).toBe(1);
  });

  it("does not count a restored game whose finish was already recorded", async () => {
    markGameMatchRecorded("code", `code-${puzzle.puzzle_id}`);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ history: [puzzle.secret], selection: ["", "", "", ""] }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    await screen.findByRole("heading", { level: 2, name: pt.codeResultWon });
    await settle();
    expect(loadPlayerStats().games.code?.played).toBe(0);
  });

  it("play again clears the save and replays the same day without stats", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    await screen.findAllByRole("combobox");
    guess(puzzle.secret as string[]);
    clock += RESULT_GUARD_MS + 1;
    fireEvent.click(screen.getByRole("button", { name: pt.restart }));
    expect(document.querySelectorAll(".code-history li")).toHaveLength(0);
    expect(screen.getByTestId("code-remaining")).toHaveTextContent("10");
    expect(loadPlayerStats().games.code?.played).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("CodeGroups share", () => {
  const original = {
    share: Object.getOwnPropertyDescriptor(navigator, "share"),
    clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  };

  function setNavigator(key: "share" | "clipboard", value: unknown) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }

  async function winAndShare() {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));
    renderGame();
    await screen.findAllByRole("combobox");
    guess(puzzle.secret as string[]);
    clock += RESULT_GUARD_MS + 1;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: pt.codeShareButton }));
    });
  }

  beforeEach(() => {
    localStorage.clear();
    clock += RESULT_GUARD_MS * 2;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    setNavigator("share", undefined);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    for (const key of ["share", "clipboard"] as const) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    }
  });

  it("builds a spoiler-free Mastermind grid with the game link", () => {
    const history = [
      { ids: puzzle.secret.slice(1).concat(puzzle.secret.slice(0, 1)), exact: 0, misplaced: 4 },
      { ids: [...puzzle.secret], exact: 4, misplaced: 0 },
    ];
    const text = generateShareText(puzzle, history, "pt-BR");
    expect(text).toContain(`K-pop Code ${puzzle.reference_date}`);
    expect(text).toContain(pt.codeShareWon(2));
    expect(text).toContain(pt.codeShareAttemptsLine(2));
    expect(text).toContain("🟨🟨🟨🟨");
    expect(text).toContain("🟩🟩🟩🟩");
    expect(text.endsWith(
      "\nhttps://kpopquiz.online/pt-br/codigo/?utm_source=share&utm_medium=social&utm_campaign=code",
    )).toBe(true);
    // No group name may reach the share text.
    for (const symbol of puzzle.symbols) {
      expect(text).not.toContain(symbol.name);
    }
    const en = generateShareText(puzzle, history, "en");
    expect(en).toContain("Code solved in 2 attempts.");
  });

  it("copies the result text through the clipboard and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await winAndShare();
    expect(writeText).toHaveBeenCalledWith(
      generateShareText(puzzle, [{ ids: [...puzzle.secret], exact: 4, misplaced: 0 }], "pt-BR"),
    );
    expect(screen.getByRole("button", { name: pt.copiedToClipboard })).toBeInTheDocument();
  });

  it("shows the text to copy by hand when the clipboard refuses", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await winAndShare();
    const field = screen.getByRole("textbox", { name: pt.shareTextLabel });
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toContain("K-pop Code");
  });
});
