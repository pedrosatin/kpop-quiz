import { renderHook } from "@testing-library/preact";
import type { MutableRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import { loadPlayerStats } from "../../lib/player-stats";
import type { QuizSession } from "../../lib/quiz-types";
import { gameCounts, matchMarkers } from "../../test/match-records";
import type { QuestionResult, QuizMachineState } from "./types";
import type { QuizTheme } from "./url-params";
import { isQuizWin, useRecordQuizMatch } from "./useRecordQuizMatch";

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

interface Props {
  state: QuizMachineState;
  session: QuizSession | null;
  history: QuestionResult[];
  theme: QuizTheme;
}

function renderRecord(initialProps: Props, recordedMatchRef: MutableRef<string | null> = { current: null }) {
  const rendered = renderHook(
    (props: Props) => useRecordQuizMatch(props.state, props.session, props.history, props.theme, recordedMatchRef),
    { initialProps },
  );
  return { ...rendered, recordedMatchRef };
}

describe("isQuizWin", () => {
  it("wins with half the questions right, rounded up, out of 10 when the session is empty", () => {
    expect(isQuizWin(session("s1", null, 5), answers(3, 2))).toBe(true);
    expect(isQuizWin(session("s1", null, 5), answers(2, 3))).toBe(false);
    expect(isQuizWin(session("s1"), answers(4))).toBe(false);
    expect(isQuizWin(session("s1"), answers(5))).toBe(true);
  });
});

describe("useRecordQuizMatch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("counts the daily round once on the result, under the seed's date", () => {
    const daily = session("s1", `kpop-daily-${today}`);
    const { rerender, recordedMatchRef } = renderRecord({ state: "question.ready", session: daily, history: [], theme: "daily" });
    expect(gameCounts("quiz")).toEqual({ played: 0, won: 0 });

    rerender({ state: "results", session: daily, history: answers(5), theme: "daily" });
    expect(gameCounts("quiz")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-quiz-daily-${today}`]);
    expect(recordedMatchRef.current).toBe(`daily-${today}`);
    expect(loadPlayerStats().games.quiz.lastPlayedDate).toBe(today);

    rerender({ state: "results", session: daily, history: answers(4), theme: "daily" });
    expect(gameCounts("quiz")).toEqual({ played: 1, won: 1 });
  });

  it("counts a daily round with no daily seed under today's date", () => {
    renderRecord({ state: "results", session: session("s1"), history: [], theme: "daily" });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-quiz-daily-${today}`]);
  });

  it("counts a general round as free play under its session id", () => {
    const { recordedMatchRef } = renderRecord({ state: "results", session: session("s1"), history: [], theme: "history" });
    expect(gameCounts("quiz")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual(["kpop-match-recorded-quiz-session-s1"]);
    expect(recordedMatchRef.current).toBe("session-s1");
    expect(loadPlayerStats().games.quiz.lastPlayedDate).toBeUndefined();
  });

  it("names a general round with no session id after the default session", () => {
    renderRecord({ state: "results", session: session(""), history: [], theme: "history" });
    expect(matchMarkers()).toEqual(["kpop-match-recorded-quiz-session-default"]);
  });

  it("counts nothing before the result or without a session", () => {
    renderRecord({ state: "question.ready", session: session("s1"), history: [], theme: "history" });
    renderRecord({ state: "results", session: null, history: [], theme: "history" });
    expect(gameCounts("quiz")).toEqual({ played: 0, won: 0 });
  });

  it("counts nothing for a daily session from an earlier day, and leaves the ref alone", () => {
    const stale = noteDailyBoard(session("s1", "kpop-daily-2026-11-13"), "2026-11-13", today);
    const { recordedMatchRef } = renderRecord({ state: "results", session: stale, history: answers(5), theme: "daily" });
    expect(gameCounts("quiz")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
    expect(recordedMatchRef.current).toBeNull();
  });

  it("skips a match the shared ref already names, even with no marker saved", () => {
    renderRecord({ state: "results", session: session("s1"), history: [], theme: "history" }, { current: "session-s1" });
    expect(gameCounts("quiz")).toEqual({ played: 0, won: 0 });
  });

  it("keeps the ref when the round leaves the result", () => {
    const general = session("s1");
    const { rerender, recordedMatchRef } = renderRecord({ state: "results", session: general, history: [], theme: "history" });
    rerender({ state: "loading", session: general, history: [], theme: "history" });
    expect(recordedMatchRef.current).toBe("session-s1");
  });

  it("does not count the daily round again on a second load", () => {
    const daily = session("s1", `kpop-daily-${today}`);
    renderRecord({ state: "results", session: daily, history: [], theme: "daily" }).unmount();
    renderRecord({ state: "results", session: daily, history: [], theme: "daily" });
    expect(gameCounts("quiz")).toEqual({ played: 1, won: 0 });
  });
});
