import { act, renderHook } from "@testing-library/preact";
import { useEffect } from "preact/hooks";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  daysSinceLastBucket,
  setGameAnalyticsConsent,
  streakBucket,
  trackGameEvent,
  useGameAnalytics,
  type GameRoundContext,
} from "./game-analytics";
import { createInitialPlayerStats, recordGameFinish, savePlayerStats, type GameId, type GameStats } from "./player-stats";
import { useCodeGroupsGame } from "../components/CodeGroups/useCodeGroupsGame";
import { useConnectionsGame } from "../components/Connections/useConnectionsGame";
import { useRecordConnectionsMatch } from "../components/Connections/useRecordConnectionsMatch";
import { useNameGuessGame } from "../components/NameGuess/useNameGuessGame";
import { useGameShareAction } from "../components/Results/use-game-share-action";
import { useTimelineGame } from "../components/Timeline/useTimelineGame";
import { useWordSearchGame } from "../components/WordSearch/useWordSearchGame";
import codeJson from "../../public/data/code-groups.pilot.json";
import connectionsJson from "../tests/fixtures/connections.daily.json";
import guessJson from "../tests/fixtures/name-guess.daily.json";
import timelineJson from "../tests/fixtures/timeline.daily.json";
import wordSearchJson from "../tests/fixtures/word-search.daily.json";
import type { CodeGroupsPuzzle } from "../data/code-groups";
import type { ConnectionsPuzzle, NameGuessPuzzle } from "./quiz-types";
import type { TimelinePuzzle } from "./timeline-types";
import type { WordSearchPuzzle } from "./word-search-types";

const context = { game: "quiz", locale: "en", mode: "expert" } as const;
const round: GameRoundContext = { ...context, isDaily: () => true, outcome: null };
const gtag = vi.fn();
const connections = connectionsJson as unknown as ConnectionsPuzzle;
const guess = guessJson as unknown as NameGuessPuzzle;
const code = codeJson as unknown as CodeGroupsPuzzle;
const timeline = timelineJson as unknown as TimelinePuzzle;
const wordSearch = wordSearchJson as unknown as WordSearchPuzzle;
function names() { return gtag.mock.calls.map((call) => call[1]); }
function completion() { return gtag.mock.calls.find((call) => call[1] === "game_complete")![2]; }
function setToday(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
}
function seedStats(game: GameId, fields: Partial<GameStats>) {
  const stats = createInitialPlayerStats();
  stats.games[game] = { ...stats.games[game], played: 9, won: 9, maxStreak: 9, ...fields };
  savePlayerStats(stats);
}

// Same hook order as ConnectionsGameContent.
function useConnectionsRound() {
  const game = useConnectionsGame(connections, "en");
  useRecordConnectionsMatch(connections, game.gameStatus, game.gameStatus !== "in_progress");
  return game;
}
type ConnectionsResult = { current: ReturnType<typeof useConnectionsGame> };
function submitGroup(result: ConnectionsResult, ids: string[]) {
  act(() => result.current.clearSelection());
  ids.forEach((id) => act(() => result.current.toggleSelectItem(id)));
  act(() => { result.current.submitGuess(); });
}
const solveConnections = (result: ConnectionsResult) =>
  connections.categories.forEach((category) => submitGroup(result, category.item_ids));
// One item of each category is never a group, and four such guesses use up the mistakes.
const failConnections = (result: ConnectionsResult) =>
  [0, 1, 2, 3].forEach((index) => submitGroup(result, connections.categories.map((category) => category.item_ids[index]!)));

beforeEach(() => {
  localStorage.clear();
  gtag.mockClear();
  vi.stubGlobal("gtag", gtag);
  setGameAnalyticsConsent("G-TEST", true);
});
afterEach(() => {
  setGameAnalyticsConsent("", false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("consented game measurement", () => {
  it("requires explicit runtime consent and a production measurement ID", () => {
    localStorage.setItem("kpop-quiz-consent", "accepted");
    setGameAnalyticsConsent("", true);
    trackGameEvent("game_start", context);
    setGameAnalyticsConsent("G-TEST", false);
    trackGameEvent("game_start", context);
    expect(gtag).not.toHaveBeenCalled();
    setGameAnalyticsConsent("G-TEST", true);
    trackGameEvent("game_start", context);
    expect(gtag).toHaveBeenCalledWith("event", "game_start", {
      game: "quiz", locale: "en", mode: "expert", send_to: "G-TEST",
    });
  });

  it("honors rejection from another tab and tolerates unavailable gtag", () => {
    localStorage.setItem("kpop-quiz-consent", "rejected");
    trackGameEvent("game_start", context);
    expect(gtag).not.toHaveBeenCalled();
    localStorage.clear();
    vi.stubGlobal("gtag", undefined);
    expect(() => trackGameEvent("game_start", context)).not.toThrow();
  });

  it("consumes pre-consent start, emits only new completion, and never replays after reacceptance", () => {
    setGameAnalyticsConsent("G-TEST", false);
    const { result, rerender } = renderHook(({ finished }) => useGameAnalytics(round, finished), { initialProps: { finished: false } });
    act(() => result.current.start());
    setGameAnalyticsConsent("G-TEST", true);
    act(() => result.current.start());
    expect(gtag).not.toHaveBeenCalled();
    rerender({ finished: true });
    expect(names()).toEqual(["game_complete"]);
    setGameAnalyticsConsent("G-TEST", false);
    setGameAnalyticsConsent("G-TEST", true);
    rerender({ finished: true });
    expect(names()).toEqual(["game_complete"]);
  });

  it("does not emit restored results and permits a fresh replay", () => {
    const { result, rerender } = renderHook(({ finished }) => useGameAnalytics(round, finished, finished), { initialProps: { finished: true } });
    expect(gtag).not.toHaveBeenCalled();
    act(() => result.current.reset());
    rerender({ finished: false });
    act(() => { result.current.start(); result.current.start(); });
    rerender({ finished: true });
    expect(names()).toEqual(["game_start", "game_complete"]);
  });

  it("drops completion during revoked consent and does not replay it", () => {
    const { result, rerender } = renderHook(({ finished }) => useGameAnalytics(round, finished), { initialProps: { finished: false } });
    act(() => result.current.start());
    setGameAnalyticsConsent("G-TEST", false);
    rerender({ finished: true });
    setGameAnalyticsConsent("G-TEST", true);
    rerender({ finished: true });
    expect(names()).toEqual(["game_start"]);
  });
});

describe("real game lifecycle", () => {
  it("counts Connections interaction, give-up and replay once each, with no reload replay", () => {
    const first = renderHook(() => useConnectionsGame(connections, "en"));
    expect(gtag).not.toHaveBeenCalled();
    act(() => first.result.current.toggleSelectItem(connections.items[0]!.id));
    act(() => first.result.current.toggleSelectItem(connections.items[1]!.id));
    act(() => first.result.current.giveUp());
    expect(names()).toEqual(["game_start", "game_complete"]);
    first.unmount();
    const restored = renderHook(() => useConnectionsGame(connections, "en"));
    expect(restored.result.current.gameStatus).toBe("lost");
    expect(names()).toEqual(["game_start", "game_complete"]);
    act(() => restored.result.current.restartGame());
    act(() => restored.result.current.giveUp());
    expect(names()).toEqual(["game_start", "game_complete", "game_start", "game_complete"]);
  });

  it("does not count asynchronous Guess restore as completion; partial reload consumes start", () => {
    const first = renderHook(() => useNameGuessGame(guess, "en"));
    act(() => { "AESPA".split("").forEach(first.result.current.addLetter); });
    act(() => first.result.current.submitGuess());
    expect(names()).toEqual(["game_start"]);
    first.unmount();
    const resumed = renderHook(() => useNameGuessGame(guess, "en"));
    act(() => resumed.result.current.giveUp());
    expect(names()).toEqual(["game_start", "game_complete"]);
    resumed.unmount();
    renderHook(() => useNameGuessGame(guess, "en"));
    expect(names()).toEqual(["game_start", "game_complete"]);
  });
});

describe("restart after a restored save", () => {
  it("emits game_start again for the next round before its game_complete", () => {
    const { result, rerender } = renderHook(
      ({ finished }) => useGameAnalytics(round, finished, true),
      { initialProps: { finished: true } },
    );
    expect(names()).toEqual([]);
    act(() => result.current.reset());
    rerender({ finished: false });
    act(() => result.current.start());
    expect(names()).toEqual(["game_start"]);
    rerender({ finished: true });
    expect(names()).toEqual(["game_start", "game_complete"]);
  });
});

describe("return bands", () => {
  const today = "2026-11-09";

  it.each([
    [undefined, "first"],
    ["2026-11-09", "0"],
    ["2026-11-08", "1"],
    ["2026-11-07", "2-7"],
    ["2026-11-02", "2-7"],
    ["2026-11-01", "8+"],
    ["2025-01-01", "8+"],
    ["2026-11-10", undefined],
  ])("classifies a last play on %s as %s", (lastPlayed, band) => {
    expect(daysSinceLastBucket(lastPlayed, today)).toBe(band);
  });

  it.each([
    [0, "0"], [1, "1"], [2, "2-3"], [3, "2-3"], [4, "4-7"], [7, "4-7"], [8, "8+"], [120, "8+"],
  ])("classifies a streak of %i as %s", (streak, band) => {
    expect(streakBucket(streak)).toBe(band);
  });
});

describe("round parameters", () => {
  const play = (outcome: GameRoundContext["outcome"], overrides: Partial<GameRoundContext> = {}) => {
    const { result, rerender, unmount } = renderHook(
      ({ finished }) => useGameAnalytics({ ...round, ...overrides, outcome: finished ? outcome : null }, finished),
      { initialProps: { finished: false } },
    );
    act(() => result.current.start());
    rerender({ finished: true });
    unmount();
  };

  it("sends daily on the start, and daily, outcome and return bands on the completion, and nothing else", () => {
    setToday("2026-11-09");
    seedStats("quiz", { lastPlayedDate: "2026-11-08", currentStreak: 5 });
    play("loss");
    expect(gtag.mock.calls).toEqual([
      ["event", "game_start", { game: "quiz", locale: "en", mode: "expert", daily: "yes", send_to: "G-TEST" }],
      ["event", "game_complete", {
        game: "quiz", locale: "en", mode: "expert", daily: "yes", outcome: "loss",
        days_since_last: "1", streak_bucket: "4-7", send_to: "G-TEST",
      }],
    ]);
  });

  it.each(["before", "after"] as const)(
    "reads the last date from before the result and the streak from after it, when stats save %s the completion effect",
    (order) => {
      setToday("2026-11-09");
      seedStats("quiz", { lastPlayedDate: "2026-11-08", currentStreak: 1 });
      const useSavedResult = (finished: boolean) => useEffect(() => {
        if (finished) recordGameFinish("quiz", true, "2026-11-09");
      }, [finished]);
      const { result, rerender } = renderHook(({ finished }) => {
        if (order === "before") useSavedResult(finished);
        const analytics = useGameAnalytics({ ...round, outcome: "win" }, finished);
        if (order === "after") useSavedResult(finished);
        return analytics;
      }, { initialProps: { finished: false } });
      act(() => result.current.start());
      rerender({ finished: true });
      expect(completion()).toMatchObject({ days_since_last: "1", streak_bucket: "2-3" });
    },
  );

  it("counts the days in Sao Paulo, where the daily boards turn", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T02:30:00Z"));
    seedStats("quiz", { lastPlayedDate: "2026-11-08", currentStreak: 2 });
    play("win");
    expect(completion().days_since_last).toBe("1");
  });

  it("reports a first-ever game and leaves out the days band when the clock moved back", () => {
    setToday("2026-11-09");
    play("win");
    expect(completion()).toMatchObject({ days_since_last: "first", streak_bucket: "0" });
    gtag.mockClear();
    seedStats("quiz", { lastPlayedDate: "2026-12-01", currentStreak: 3 });
    play("win");
    expect(completion()).not.toHaveProperty("days_since_last");
    expect(completion()).toMatchObject({ streak_bucket: "2-3" });
  });

  it("sends no return bands for the Map, which keeps no stats", () => {
    play("win", { game: "map", locale: "en" });
    expect(completion()).toMatchObject({ game: "map", daily: "yes", outcome: "win" });
    expect(completion()).not.toHaveProperty("days_since_last");
    expect(completion()).not.toHaveProperty("streak_bucket");
  });

  it("decides daily once per round, when it begins", () => {
    const isDaily = vi.fn(() => true);
    const { result, rerender } = renderHook(
      ({ finished }) => useGameAnalytics({ ...round, isDaily, outcome: finished ? "win" : null }, finished),
      { initialProps: { finished: false } },
    );
    act(() => { result.current.start(); result.current.start(); });
    isDaily.mockReturnValue(false);
    rerender({ finished: true });
    expect(isDaily).toHaveBeenCalledTimes(1);
    expect(completion().daily).toBe("yes");
    act(() => result.current.reset());
    rerender({ finished: false });
    act(() => result.current.start());
    expect(gtag.mock.calls.at(-1)![2].daily).toBe("no");
  });

  it("sends none of it without consent, and after a rejection in another tab", () => {
    setGameAnalyticsConsent("G-TEST", false);
    play("win");
    expect(gtag).not.toHaveBeenCalled();
    setGameAnalyticsConsent("G-TEST", true);
    localStorage.setItem("kpop-quiz-consent", "rejected");
    play("win");
    expect(gtag).not.toHaveBeenCalled();
  });

  it("carries only fixed labels, never an identifier, an answer or a name", () => {
    const { result } = renderHook(useConnectionsRound);
    solveConnections(result);
    const allowed = ["game", "locale", "mode", "daily", "outcome", "days_since_last", "streak_bucket", "send_to"];
    expect(names()).toEqual(["game_start", "game_complete"]);
    for (const [, , params] of gtag.mock.calls) {
      expect(allowed).toEqual(expect.arrayContaining(Object.keys(params)));
    }
    const sent = JSON.stringify(gtag.mock.calls);
    expect(sent).not.toContain(connections.puzzle_id);
    expect(sent).not.toContain(connections.reference_date);
    for (const item of connections.items) {
      expect(sent).not.toContain(item.id);
      expect(sent).not.toContain(item.canonical_name);
    }
  });
});

describe("daily challenge against free play", () => {
  const summary = () => gtag.mock.calls.map(([, name, params]) => [name, params.daily, params.days_since_last]);

  it("marks the first round as daily and a replay as free play, on both events", () => {
    setToday(connections.reference_date);
    const { result } = renderHook(useConnectionsRound);
    act(() => result.current.giveUp());
    act(() => result.current.restartGame());
    act(() => result.current.giveUp());
    expect(summary()).toEqual([
      ["game_start", "yes", undefined],
      ["game_complete", "yes", "first"],
      ["game_start", "no", undefined],
      ["game_complete", "no", "0"],
    ]);
  });

  it("keeps a saved first round daily and a saved replay free, without another start", () => {
    setToday(connections.reference_date);
    const first = renderHook(useConnectionsRound);
    submitGroup(first.result, connections.categories.map((category) => category.item_ids[0]!));
    first.unmount();
    const resumedFirst = renderHook(useConnectionsRound);
    act(() => resumedFirst.result.current.giveUp());
    expect(summary()).toEqual([["game_start", "yes", undefined], ["game_complete", "yes", "first"]]);

    act(() => resumedFirst.result.current.restartGame());
    submitGroup(resumedFirst.result, connections.categories.map((category) => category.item_ids[0]!));
    resumedFirst.unmount();
    const resumedReplay = renderHook(useConnectionsRound);
    act(() => resumedReplay.result.current.giveUp());
    expect(summary().slice(2)).toEqual([["game_start", "no", undefined], ["game_complete", "no", "0"]]);
    resumedReplay.unmount();

    renderHook(useConnectionsRound);
    expect(gtag).toHaveBeenCalledTimes(4);
  });
});

describe("outcome of each game", () => {
  function outcomeOf(playRound: () => void) {
    localStorage.clear();
    gtag.mockClear();
    playRound();
    expect(names()).toEqual(["game_start", "game_complete"]);
    return completion().outcome;
  }

  it("tells Connections wins, losses and give-ups apart", () => {
    const play = (moves: (result: ConnectionsResult) => void) => outcomeOf(() => {
      const { result, unmount } = renderHook(useConnectionsRound);
      moves(result);
      unmount();
    });
    expect(play(solveConnections)).toBe("win");
    expect(play(failConnections)).toBe("loss");
    expect(play((result) => act(() => result.current.giveUp()))).toBe("give_up");
  });

  it("tells Guess wins, losses and give-ups apart", () => {
    const type = (result: { current: ReturnType<typeof useNameGuessGame> }, word: string) => {
      act(() => { word.split("").forEach(result.current.addLetter); });
      act(() => result.current.submitGuess());
    };
    const wrong = guess.valid_guesses.filter((word) => word !== guess.target.normalized_name);
    const play = (moves: (result: { current: ReturnType<typeof useNameGuessGame> }) => void) => outcomeOf(() => {
      const { result, unmount } = renderHook(() => useNameGuessGame(guess, "en"));
      moves(result);
      unmount();
    });
    expect(play((result) => type(result, guess.target.normalized_name))).toBe("win");
    expect(play((result) => wrong.slice(0, guess.max_attempts).forEach((word) => type(result, word)))).toBe("loss");
    expect(play((result) => {
      type(result, wrong[0]!);
      act(() => result.current.giveUp());
    })).toBe("give_up");
  });

  it("tells Timeline wins, losses and give-ups apart, even with a correct board at give-up", () => {
    const play = (moves: (result: { current: ReturnType<typeof useTimelineGame> }) => void) => outcomeOf(() => {
      const { result, unmount } = renderHook(() => useTimelineGame(timeline, "en"));
      moves(result);
      unmount();
    });
    const solve = (result: { current: ReturnType<typeof useTimelineGame> }) =>
      act(() => result.current.setOrder(result.current.canonicalOrder.map((event) => event.id)));
    expect(play((result) => { solve(result); act(() => result.current.submit()); })).toBe("win");
    expect(play((result) => act(() => result.current.submit()))).toBe("loss");
    expect(play((result) => { solve(result); act(() => result.current.submit(true)); })).toBe("give_up");
  });

  it("tells Word Search wins and give-ups apart", () => {
    const play = (moves: (result: { current: ReturnType<typeof useWordSearchGame> }) => void) => outcomeOf(() => {
      const { result, unmount } = renderHook(() => useWordSearchGame(wordSearch, "en"));
      moves(result);
      unmount();
    });
    expect(play((result) => {
      for (const word of wordSearch.words) {
        act(() => result.current.handleCellPointerDown(word.start_row, word.start_col));
        act(() => result.current.handleCellPointerEnter(word.end_row, word.end_col));
        act(() => result.current.handleCellPointerUp(word.end_row, word.end_col));
      }
    })).toBe("win");
    expect(play((result) => act(() => result.current.giveUp()))).toBe("give_up");
  });

  it("tells Code wins and losses apart", () => {
    const play = (guesses: string[][]) => outcomeOf(() => {
      const { result, unmount } = renderHook(() => useCodeGroupsGame(code, "en"));
      for (const ids of guesses) {
        ids.forEach((id, index) => act(() => result.current.selectValue(index, id)));
        act(() => result.current.submit());
      }
      unmount();
    });
    const secret = code.secret as string[];
    expect(play([secret])).toBe("win");
    // A repeated guess costs nothing, so the loss takes distinct wrong guesses.
    const orders = (ids: string[]): string[][] =>
      ids.length <= 1 ? [ids] : ids.flatMap((id, i) => orders(ids.filter((_, j) => j !== i)).map((rest) => [id, ...rest]));
    const wrong = orders(secret).filter((ids) => ids.join() !== secret.join());
    expect(play(wrong.slice(0, code.max_attempts))).toBe("loss");
  });
});

describe("successful sharing", () => {
  it("tracks native success and clipboard fallback, excludes cancellation/failure and text", async () => {
    const native = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: native, clipboard: { writeText: copy } });
    const { result } = renderHook(() => useGameShareAction({ analytics: context }));
    await act(async () => { await result.current.handleShare("private result"); });
    expect(gtag).toHaveBeenLastCalledWith("event", "share", {
      game: "quiz", locale: "en", mode: "expert", method: "native",
      content_type: "game_result", item_id: "quiz", send_to: "G-TEST",
    });
    native.mockRejectedValue(new DOMException("cancel", "AbortError"));
    await act(async () => { await result.current.handleShare("private result"); });
    expect(names()).toEqual(["share"]);
    expect(copy).not.toHaveBeenCalled();
    native.mockRejectedValue(new Error("unsupported"));
    await act(async () => { await result.current.handleShare("private result"); });
    expect(gtag.mock.calls[1]![2].method).toBe("clipboard");
    copy.mockRejectedValue(new Error("denied"));
    await act(async () => { await result.current.handleShare("private result"); });
    expect(names()).toEqual(["share", "share"]);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("private result");
  });
});
