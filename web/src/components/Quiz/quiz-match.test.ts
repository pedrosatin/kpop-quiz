import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import type { QuizSession } from "../../lib/quiz-types";
import type { QuestionResult } from "./types";
import { isQuizWin, quizDailyRound } from "./quiz-match";

const today = "2026-11-14";

function session(sessionId: string, seed: string | null = null, questionCount = 0): QuizSession {
  return {
    session_id: sessionId,
    config: { seed },
    questions: Array.from({ length: questionCount }, () => ({})),
  } as unknown as QuizSession;
}

function answers(correct: number, wrong = 0): QuestionResult[] {
  return [
    ...Array.from({ length: correct }, () => ({ isCorrect: true })),
    ...Array.from({ length: wrong }, () => ({ isCorrect: false })),
  ] as QuestionResult[];
}

describe("isQuizWin", () => {
  it("wins with half the questions right, rounded up, out of 10 when the session is empty", () => {
    expect(isQuizWin(session("s1", null, 5), answers(3, 2))).toBe(true);
    expect(isQuizWin(session("s1", null, 5), answers(2, 3))).toBe(false);
    expect(isQuizWin(session("s1"), answers(4))).toBe(false);
    expect(isQuizWin(session("s1"), answers(5))).toBe(true);
  });
});

describe("quizDailyRound", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("names a daily round after the seed's date", () => {
    expect(quizDailyRound(session("s1", `kpop-daily-${today}`), "daily")).toEqual({
      matchId: `daily-${today}`,
      date: today,
    });
  });

  it("dates a daily round with no seed today", () => {
    expect(quizDailyRound(session("s1"), "daily")).toEqual({
      matchId: `daily-${today}`,
      date: today,
    });
  });

  it("names a general round after its session id with no date", () => {
    expect(quizDailyRound(session("s1"), "history")).toEqual({
      matchId: "session-s1",
    });
  });

  it("names a general round with no session id after the default session", () => {
    expect(quizDailyRound(session(""), "history")).toEqual({
      matchId: "session-default",
    });
  });

  it("has no round without a session", () => {
    expect(quizDailyRound(null, "daily")).toBeNull();
  });

  it("has no round for a daily session from an earlier day", () => {
    const stale = noteDailyBoard(session("s1", "kpop-daily-2026-11-13"), "2026-11-13", today);
    expect(quizDailyRound(stale, "daily")).toBeNull();
  });
});
