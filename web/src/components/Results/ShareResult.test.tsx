import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, formatSquares, generateShareText, ShareResult } from "./ShareResult";
import { getMessages } from "../../i18n/catalog";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");
const PT_URL = "https://kpopquiz.online/pt-br/?utm_source=share&utm_medium=social&utm_campaign=quiz";
const EN_URL = "https://kpopquiz.online/en/?utm_source=share&utm_medium=social&utm_campaign=quiz";

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
      locale: "pt-BR",
    });

    const expected = `K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`;
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

  it("includes daily date indicator in share text when dailyDate is provided", () => {
    const textPt = generateShareText({
      correctCount: 8,
      totalQuestions: 10,
      results: [true, true, true, true, false, true, true, true, true, false],
      playMode: "standard",
      cluesUsedCount: 1,
      elapsedSeconds: 222,
      messages: ptMessages,
      locale: "pt-BR",
      dailyDate: "2026-09-16",
    });
    expect(textPt).toBe(`K-pop Quiz Diário 2026-09-16 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`);

    const textEn = generateShareText({
      correctCount: 8,
      totalQuestions: 10,
      results: [true, true, true, true, false, true, true, true, true, false],
      playMode: "standard",
      cluesUsedCount: 1,
      elapsedSeconds: 222,
      messages: enMessages,
      locale: "en",
      dailyDate: "2026-09-16",
    });
    expect(textEn).toBe(`K-pop Quiz Daily 2026-09-16 8/10\n■■■■□ ■■■■□\nStandard · 1 clue · 03:42\n${EN_URL}`);
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
        locale="pt-BR"
      />
    );

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    expect(shareBtn).toBeInTheDocument();

    fireEvent.click(shareBtn);
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(shareMock).toHaveBeenCalledWith({
      title: "K-pop Quiz",
      text: "K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42",
      url: PT_URL,
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
        locale="pt-BR"
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
        locale="pt-BR"
      />
    );

    const copyBtn = screen.getByRole("button", { name: "Copiar resultado" });
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(
      `K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`
    );

    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent("Resultado copiado.");
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
        locale="pt-BR"
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "Texto do resultado" }) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.readOnly).toBe(true);
    expect(textarea.value).toBe(`K-pop Quiz 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42\n${PT_URL}`);
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
        locale="pt-BR"
      />
    );

    const copyBtn = screen.getByRole("button", { name: "Copiar resultado" });
    fireEvent.click(copyBtn);

    const textarea = await screen.findByRole("textbox", { name: "Texto do resultado" });
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
        locale="pt-BR"
        dailyDate="2026-09-16"
      />
    );

    const shareBtn = screen.getByRole("button", { name: "Compartilhar resultado" });
    fireEvent.click(shareBtn);
    expect(shareMock).toHaveBeenCalledWith({
      title: "K-pop Quiz",
      text: "K-pop Quiz Diário 2026-09-16 8/10\n■■■■□ ■■■■□\nPadrão · 1 pista · 03:42",
      url: PT_URL,
    });
  });
});
