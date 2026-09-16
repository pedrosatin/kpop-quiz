import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, formatSquares, generateShareText, ShareResult } from "./ShareResult";
import { getMessages } from "../../i18n/catalog";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");

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
      correctCount: 8,
      totalQuestions: 10,
      results: [true, true, true, true, false, true, true, true, true, false],
      playMode: "standard",
      cluesUsedCount: 1,
      elapsedSeconds: 222,
      messages: ptMessages,
    });

    const expected = "K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42";
    expect(text).toBe(expected);

    // Verify absence of entity names, answers, prompts or leakages
    expect(text).not.toContain("TWICE");
    expect(text).not.toContain("BTS");
    expect(text).not.toContain("pergunta");
    expect(text).not.toContain("resposta");
  });

  it("generates spoiler-free share text matching the EN specification", () => {
    const text = generateShareText({
      correctCount: 8,
      totalQuestions: 10,
      results: [true, true, true, true, false, true, true, true, true, false],
      playMode: "standard",
      cluesUsedCount: 1,
      elapsedSeconds: 222,
      messages: enMessages,
    });

    const expected = "K-pop Quiz 8/10\n■■■■□ ■■■■□\nStandard · 1 hint · 03:42";
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
    });
    expect(textEn).toContain("Expert · 0 hints · 01:25");
  });

  it("includes daily date indicator in share text when dailyDate is provided", () => {
    const textPt = generateShareText({
      correctCount: 8,
      totalQuestions: 10,
      results: [true, true, true, true, false, true, true, true, true, false],
      playMode: "standard",
      cluesUsedCount: 1,
      elapsedSeconds: 222,
      messages: ptMessages,
      dailyDate: "2026-09-16",
    });
    expect(textPt).toBe("K-pop Quiz Diário 2026-09-16 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42");

    const textEn = generateShareText({
      correctCount: 8,
      totalQuestions: 10,
      results: [true, true, true, true, false, true, true, true, true, false],
      playMode: "standard",
      cluesUsedCount: 1,
      elapsedSeconds: 222,
      messages: enMessages,
      dailyDate: "2026-09-16",
    });
    expect(textEn).toBe("K-pop Quiz Daily 2026-09-16 8/10\n■■■■□ ■■■■□\nStandard · 1 hint · 03:42");
  });
});

describe("ShareResult component", () => {
  const originalNavigator = { ...window.navigator };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("calls navigator.share when available", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, share: shareMock },
      writable: true,
      configurable: true,
    });

    render(
      <ShareResult
        correctCount={8}
        totalQuestions={10}
        results={[true, true, true, true, false, true, true, true, true, false]}
        playMode="standard"
        cluesUsedCount={1}
        elapsedSeconds={222}
        messages={ptMessages}
      />
    );

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    expect(shareBtn).toBeInTheDocument();

    fireEvent.click(shareBtn);
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(shareMock).toHaveBeenCalledWith({
      text: "K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42",
    });
  });

  it("handles navigator.share AbortError gracefully without displaying errors", async () => {
    const abortError = new Error("Abort");
    abortError.name = "AbortError";
    const shareMock = vi.fn().mockRejectedValue(abortError);
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, share: shareMock },
      writable: true,
      configurable: true,
    });

    render(
      <ShareResult
        correctCount={8}
        totalQuestions={10}
        results={[true, true, true, true, false, true, true, true, true, false]}
        playMode="standard"
        cluesUsedCount={1}
        elapsedSeconds={222}
        messages={ptMessages}
      />
    );

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    fireEvent.click(shareBtn);

    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to clipboard.writeText when navigator.share is absent", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, share: undefined, clipboard: { writeText: writeTextMock } },
      writable: true,
      configurable: true,
    });

    render(
      <ShareResult
        correctCount={8}
        totalQuestions={10}
        results={[true, true, true, true, false, true, true, true, true, false]}
        playMode="standard"
        cluesUsedCount={1}
        elapsedSeconds={222}
        messages={ptMessages}
      />
    );

    const copyBtn = screen.getByRole("button", { name: "Copiar resultado" });
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(
      "K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42"
    );

    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent("Copiado para a área de transferência.");
  });

  it("falls back to textarea when neither navigator.share nor clipboard is available", () => {
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, share: undefined, clipboard: undefined },
      writable: true,
      configurable: true,
    });

    render(
      <ShareResult
        correctCount={8}
        totalQuestions={10}
        results={[true, true, true, true, false, true, true, true, true, false]}
        playMode="standard"
        cluesUsedCount={1}
        elapsedSeconds={222}
        messages={ptMessages}
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "Texto para cópia" }) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.readOnly).toBe(true);
    expect(textarea.value).toBe("K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42");
  });

  it("falls back to textarea when clipboard copy fails", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, share: undefined, clipboard: { writeText: writeTextMock } },
      writable: true,
      configurable: true,
    });

    render(
      <ShareResult
        correctCount={8}
        totalQuestions={10}
        results={[true, true, true, true, false, true, true, true, true, false]}
        playMode="standard"
        cluesUsedCount={1}
        elapsedSeconds={222}
        messages={ptMessages}
      />
    );

    const copyBtn = screen.getByRole("button", { name: "Copiar resultado" });
    fireEvent.click(copyBtn);

    const textarea = await screen.findByRole("textbox", { name: "Texto para cópia" });
    expect(textarea).toBeInTheDocument();
  });

  it("includes daily date in navigator.share when dailyDate is passed to ShareResult", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "navigator", {
      value: { ...originalNavigator, share: shareMock },
      writable: true,
      configurable: true,
    });

    render(
      <ShareResult
        correctCount={8}
        totalQuestions={10}
        results={[true, true, true, true, false, true, true, true, true, false]}
        playMode="standard"
        cluesUsedCount={1}
        elapsedSeconds={222}
        messages={ptMessages}
        dailyDate="2026-09-16"
      />
    );

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    fireEvent.click(shareBtn);
    expect(shareMock).toHaveBeenCalledWith({
      text: "K-pop Quiz Diário 2026-09-16 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42",
    });
  });
});
