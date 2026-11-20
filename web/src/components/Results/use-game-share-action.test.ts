import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setGameAnalyticsConsent,
} from "../../lib/game-analytics";
import { COPIED_FEEDBACK_MS, useGameShareAction } from "./use-game-share-action";
import * as shareText from "./share-text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setGameAnalyticsConsent("", false);
});

describe("useGameShareAction reentry", () => {
  it("allows one share at a time and releases the lock after cancellation", async () => {
    let cancel!: (reason: unknown) => void;
    const share = vi.fn(() => new Promise<void>((_resolve, reject) => { cancel = reject; }));
    vi.stubGlobal("navigator", { share });
    const { result } = renderHook(() => useGameShareAction());
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleShare("result"); });
    await result.current.handleShare("result");
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => { cancel({ name: "AbortError" }); await pending; });
    act(() => { pending = result.current.handleShare("result"); });
    expect(share).toHaveBeenCalledTimes(2);
    await act(async () => { cancel({ name: "AbortError" }); await pending; });
  });
});

describe("useGameShareAction outcomes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks native share and leaves copied/failed clear on success", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    setGameAnalyticsConsent("G-TEST", true);
    vi.spyOn(shareText, "shareTextToUser").mockResolvedValue("shared");

    const onCopied = vi.fn();
    const onShareFailed = vi.fn();
    const { result } = renderHook(() =>
      useGameShareAction({
        analytics: { game: "grid", locale: "pt-BR", daily: "yes" },
        onCopied,
        onShareFailed,
      }),
    );

    await act(async () => {
      await result.current.handleShare("grid result");
    });

    expect(result.current.copied).toBe(false);
    expect(result.current.shareFailed).toBe(false);
    expect(onCopied).not.toHaveBeenCalled();
    expect(onShareFailed).not.toHaveBeenCalled();
    expect(gtag).toHaveBeenCalledWith("event", "share", {
      game: "grid",
      locale: "pt-BR",
      daily: "yes",
      method: "native",
      content_type: "game_result",
      item_id: "grid",
      send_to: "G-TEST",
    });
  });

  it("sets copied for clipboard success, tracks analytics, and clears after COPIED_FEEDBACK_MS", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    setGameAnalyticsConsent("G-TEST", true);
    vi.spyOn(shareText, "shareTextToUser").mockResolvedValue("copied");

    const onCopied = vi.fn();
    const { result } = renderHook(() =>
      useGameShareAction({
        analytics: { game: "quiz", locale: "en", mode: "expert" },
        onCopied,
      }),
    );

    await act(async () => {
      await result.current.handleShare("quiz result");
    });

    expect(result.current.copied).toBe(true);
    expect(result.current.shareFailed).toBe(false);
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", "share", {
      game: "quiz",
      locale: "en",
      mode: "expert",
      method: "clipboard",
      content_type: "game_result",
      item_id: "quiz",
      send_to: "G-TEST",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPIED_FEEDBACK_MS);
    });
    expect(result.current.copied).toBe(false);
  });

  it("ignores aborted shares without analytics or failure flags", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    setGameAnalyticsConsent("G-TEST", true);
    vi.spyOn(shareText, "shareTextToUser").mockResolvedValue("aborted");

    const onShareFailed = vi.fn();
    const { result } = renderHook(() =>
      useGameShareAction({
        analytics: { game: "quiz", locale: "en" },
        onShareFailed,
      }),
    );

    await act(async () => {
      await result.current.handleShare("ignored");
    });

    expect(result.current.copied).toBe(false);
    expect(result.current.shareFailed).toBe(false);
    expect(onShareFailed).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sets shareFailed and skips analytics when transport fails", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    setGameAnalyticsConsent("G-TEST", true);
    vi.spyOn(shareText, "shareTextToUser").mockResolvedValue("failed");

    const onShareFailed = vi.fn();
    const { result } = renderHook(() =>
      useGameShareAction({
        analytics: { game: "quiz", locale: "en" },
        onShareFailed,
      }),
    );

    await act(async () => {
      await result.current.handleShare("no channel");
    });

    expect(result.current.shareFailed).toBe(true);
    expect(result.current.copied).toBe(false);
    expect(onShareFailed).toHaveBeenCalledTimes(1);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("delegates the share text to shareTextToUser", async () => {
    const transport = vi.spyOn(shareText, "shareTextToUser").mockResolvedValue("shared");
    const { result } = renderHook(() => useGameShareAction());

    await act(async () => {
      await result.current.handleShare("exact payload");
    });

    expect(transport).toHaveBeenCalledWith("exact payload");
  });
});
