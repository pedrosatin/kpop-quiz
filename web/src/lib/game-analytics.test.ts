import { act, renderHook } from "@testing-library/preact";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { setGameAnalyticsConsent, trackGameEvent, useGameAnalytics } from "./game-analytics";
import { useConnectionsGame } from "../components/Connections/useConnectionsGame";
import { useNameGuessGame } from "../components/NameGuess/useNameGuessGame";
import { useGameShareAction } from "../components/Results/use-game-share-action";
import connectionsJson from "../tests/fixtures/connections.daily.json";
import guessJson from "../tests/fixtures/name-guess.daily.json";
import type { ConnectionsPuzzle, NameGuessPuzzle } from "./quiz-types";

const context = { game: "quiz", locale: "en", mode: "expert" } as const;
const gtag = vi.fn();
const connections = connectionsJson as unknown as ConnectionsPuzzle;
const guess = guessJson as unknown as NameGuessPuzzle;
function names() { return gtag.mock.calls.map((call) => call[1]); }

beforeEach(() => {
  localStorage.clear();
  gtag.mockClear();
  vi.stubGlobal("gtag", gtag);
  setGameAnalyticsConsent("G-TEST", true);
});
afterEach(() => {
  setGameAnalyticsConsent("", false);
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
    const { result, rerender } = renderHook(({ finished }) => useGameAnalytics(context, finished), { initialProps: { finished: false } });
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
    const { result, rerender } = renderHook(({ finished }) => useGameAnalytics(context, finished, finished), { initialProps: { finished: true } });
    expect(gtag).not.toHaveBeenCalled();
    act(() => result.current.reset());
    rerender({ finished: false });
    act(() => { result.current.start(); result.current.start(); });
    rerender({ finished: true });
    expect(names()).toEqual(["game_start", "game_complete"]);
  });

  it("drops completion during revoked consent and does not replay it", () => {
    const { result, rerender } = renderHook(({ finished }) => useGameAnalytics(context, finished), { initialProps: { finished: false } });
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
