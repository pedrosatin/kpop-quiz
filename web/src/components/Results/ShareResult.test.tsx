import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, formatSquares, generateShareText, ShareResult } from "./ShareResult";
import { getMessages } from "../../i18n/catalog";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");
const PT_URL = "https://kpopquiz.online/pt-br/?s=quiz";
const EN_URL = "https://kpopquiz.online/en/?s=quiz";

const baseProps = {
  correctCount: 8,
  totalQuestions: 10,
  results: [true, true, true, true, false, true, true, true, true, false],
  playMode: "standard" as const,
  cluesUsedCount: 1,
  elapsedSeconds: 222,
  messages: ptMessages,
  locale: "pt-BR" as const,
};

describe("ShareResult helper functions", () => {
  it("formats duration correctly into mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(42)).toBe("00:42");
    expect(formatDuration(222)).toBe("03:42");
    expect(formatDuration(3600)).toBe("60:00");
  });

  it("formats squares in blocks of 5", () => {
    expect(formatSquares([])).toBe("");
    expect(formatSquares([true, true, true])).toBe("■■■");
    expect(formatSquares([true, true, true, true, false, true, true, true, true, false])).toBe("■■■■□ ■■■■□");
  });

  it("generates spoiler-free share text matching the PT-BR specification", () => {
    const text = generateShareText({
      ...baseProps,
      messages: ptMessages,
      locale: "pt-BR",
    });

    const expected = `K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`;
    expect(text).toBe(expected);

    expect(text).not.toContain("TWICE");
    expect(text).not.toContain("BTS");
    expect(text).not.toContain("pergunta");
    expect(text).not.toContain("resposta");
  });

  it("generates spoiler-free share text matching the EN specification", () => {
    const text = generateShareText({
      ...baseProps,
      messages: enMessages,
      locale: "en",
    });

    const expected = `K-pop Quiz 8/10\n■■■■□ ■■■■□\nStandard · 1 clue · 03:42\n${EN_URL}`;
    expect(text).toBe(expected);
  });

  it("handles plural clues and different play modes", () => {
    const textPt = generateShareText({
      correctCount: 6,
      totalQuestions: 10,
      results: [true, false, true, false, true, false, true, true, true, false],
      playMode: "assisted",
      cluesUsedCount: 3,
      elapsedSeconds: 150,
      messages: ptMessages,
      locale: "pt-BR",
    });
    expect(textPt).toContain("Assistido · 3 pistas · 02:30");

    const textEn = generateShareText({
      correctCount: 10,
      totalQuestions: 10,
      results: Array(10).fill(true),
      playMode: "expert",
      cluesUsedCount: 0,
      elapsedSeconds: 85,
      messages: enMessages,
      locale: "en",
    });
    expect(textEn).toContain("Expert · 0 clues · 01:25");
  });

  it("opens daily share text with the challenge number and keeps free play without #N", () => {
    const textPt = generateShareText({
      ...baseProps,
      dailyDate: "2026-09-18",
    });
    expect(textPt).toBe(`K-pop Quiz #1 · Quiz\n8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`);

    const textEn = generateShareText({
      ...baseProps,
      messages: enMessages,
      locale: "en",
      dailyDate: "2026-09-18",
    });
    expect(textEn).toBe(`K-pop Quiz #1 · Quiz\n8/10\n■■■■□ ■■■■□\nStandard · 1 clue · 03:42\n${EN_URL}`);

    const free = generateShareText({ ...baseProps });
    expect(free.startsWith("K-pop Quiz 8/10\n")).toBe(true);
    expect(free).not.toMatch(/K-pop Quiz #\d+/);
  });
});

describe("ShareResult component UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setGameAnalyticsConsent("", false);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("labels the button Compartilhar when native share is available and wires the share text", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareMock, clipboard: { writeText: vi.fn() } });

    render(<ShareResult {...baseProps} />);

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    await act(async () => {
      fireEvent.click(shareBtn);
    });

    expect(shareMock).toHaveBeenCalledWith({
      text: `K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`,
    });
  });

  it("labels the button Copiar when only clipboard is available and shows copied feedback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });

    render(<ShareResult {...baseProps} />);

    const copyBtn = screen.getByRole("button", { name: "Copiar resultado" });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      `K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Resultado copiado.");
  });

  it("opens the textarea on mount when neither share nor clipboard is available", () => {
    vi.stubGlobal("navigator", {});

    render(<ShareResult {...baseProps} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "Texto do resultado" }) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    expect(textarea.value).toBe(`K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`);
  });

  it("opens the textarea when the share action fails", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });

    render(<ShareResult {...baseProps} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar resultado" }));
    });

    expect(await screen.findByRole("textbox", { name: "Texto do resultado" })).toBeInTheDocument();
  });

  it("keeps abort silent without opening the fallback", async () => {
    const abortError = Object.assign(new Error("Abort"), { name: "AbortError" });
    const shareMock = vi.fn().mockRejectedValue(abortError);
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share: shareMock, clipboard: { writeText } });

    render(<ShareResult {...baseProps} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));
    });

    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("includes the daily challenge text when dailyDate is set", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareMock, clipboard: { writeText: vi.fn() } });

    render(<ShareResult {...baseProps} dailyDate="2026-09-18" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));
    });

    expect(shareMock).toHaveBeenCalledWith({
      text: `K-pop Quiz #1 · Quiz\n8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`,
    });
  });

  it("reports quiz share to GA4 as game_result / quiz with the daily flag", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    setGameAnalyticsConsent("G-TEST", true);
    vi.stubGlobal("navigator", {
      share: vi.fn().mockResolvedValue(undefined),
      clipboard: { writeText: vi.fn() },
    });

    render(<ShareResult {...baseProps} dailyDate="2026-09-18" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));
    });

    expect(gtag).toHaveBeenCalledWith(
      "event",
      "share",
      expect.objectContaining({
        game: "quiz",
        content_type: "game_result",
        item_id: "quiz",
        daily: "yes",
        method: "native",
        mode: "standard",
      }),
    );
  });
});
