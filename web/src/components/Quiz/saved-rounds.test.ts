import { afterEach, describe, expect, it } from "vitest";
import dailyPtSession from "../../tests/fixtures/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import type { Locale, PlayMode, QuizSession } from "../../lib/quiz-types";
import { dailySeedDate } from "./daily-seed";
import { findFinishedDailySave, findOtherLocaleRound } from "./saved-rounds";
import {
  buildQuizProgressSave,
  listQuizProgressSaves,
  QUIZ_PROGRESS_STORAGE_PREFIX,
  quizProgressStorageKey,
  saveQuizProgress,
} from "./storage";
import type { QuizTheme } from "./url-params";
import { otherLocaleRoundHref } from "./useOtherLocaleRound";

const daily = dailyPtSession as QuizSession;
const general = ptSession as QuizSession;
const DAY = dailySeedDate(daily)!;

function save({
  session = general,
  locale = "pt-BR",
  playMode = "standard",
  theme = "history",
  machineState = "question.ready",
  questionIndex = 0,
  startedAtMs = 1_000,
  decades = [],
}: {
  session?: QuizSession;
  locale?: Locale;
  playMode?: PlayMode;
  theme?: QuizTheme;
  machineState?: "question.ready" | "results";
  questionIndex?: number;
  startedAtMs?: number;
  decades?: (1990 | 2000 | 2010 | 2020)[];
} = {}) {
  const answered = machineState === "results" ? session.questions.length : questionIndex;
  return buildQuizProgressSave({
    session,
    sessionSource: "published",
    locale,
    playMode,
    theme,
    decades,
    timerEnabled: false,
    machineState,
    questionIndex: machineState === "results" ? session.questions.length - 1 : questionIndex,
    selectedId: null,
    timedOut: false,
    score: 0,
    revealedClues: [],
    history: session.questions.slice(0, answered).map((question) => ({
      question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0,
    })),
    questionDeadlineMs: null,
    startedAtMs,
    elapsedSeconds: 0,
    gaveUp: false,
    replayNotice: null,
  });
}

afterEach(() => window.localStorage.clear());

describe("listQuizProgressSaves", () => {
  it("reads every valid slot and leaves the others alone", () => {
    saveQuizProgress(save());
    saveQuizProgress(save({ locale: "en", playMode: "expert" }));
    window.localStorage.setItem(`${QUIZ_PROGRESS_STORAGE_PREFIX}broken`, "{not json");
    window.localStorage.setItem("kpop-player-stats-v1", "{}");

    expect(listQuizProgressSaves().map((s) => `${s.locale}|${s.play_mode}`).sort()).toEqual(["en|expert", "pt-BR|standard"]);
    expect(window.localStorage.getItem(`${QUIZ_PROGRESS_STORAGE_PREFIX}broken`)).toBe("{not json");
  });

  it("skips a save sitting in another config's slot", () => {
    const misplaced = save({ locale: "en" });
    window.localStorage.setItem(
      quizProgressStorageKey({ locale: "pt-BR", playMode: "standard", theme: "history", decades: [] }),
      JSON.stringify(misplaced),
    );
    expect(listQuizProgressSaves()).toEqual([]);
  });
});

describe("findFinishedDailySave", () => {
  it("prefers the mode in use and falls back to another mode of the same language", () => {
    saveQuizProgress(save({ session: daily, theme: "daily", machineState: "results", playMode: "expert" }));
    expect(findFinishedDailySave("pt-BR", DAY, "standard")?.play_mode).toBe("expert");

    saveQuizProgress(save({ session: daily, theme: "daily", machineState: "results", playMode: "standard" }));
    expect(findFinishedDailySave("pt-BR", DAY, "standard")?.play_mode).toBe("standard");
  });

  it("ignores rounds in progress, other dates, the general quiz and the other language", () => {
    saveQuizProgress(save({ session: daily, theme: "daily", questionIndex: 2 }));
    saveQuizProgress(save({ session: general, machineState: "results" }));
    saveQuizProgress(save({ session: daily, theme: "daily", machineState: "results", locale: "en" }));

    expect(findFinishedDailySave("pt-BR", DAY, "standard")).toBeNull();
    expect(findFinishedDailySave("pt-BR", "2099-01-01", "standard")).toBeNull();
  });
});

describe("findOtherLocaleRound", () => {
  it("finds the most recently started round in progress in the other language", () => {
    saveQuizProgress(save({ locale: "en", startedAtMs: 1_000, questionIndex: 1 }));
    saveQuizProgress(save({ locale: "en", playMode: "expert", startedAtMs: 5_000, questionIndex: 4 }));
    saveQuizProgress(save({ locale: "pt-BR", startedAtMs: 9_000 }));

    const found = findOtherLocaleRound("pt-BR", DAY);
    expect(found).toMatchObject({ locale: "en", play_mode: "expert", question_index: 4 });
    expect(findOtherLocaleRound("en", DAY)).toMatchObject({ locale: "pt-BR" });
  });

  it("skips finished rounds and a daily round from another day", () => {
    saveQuizProgress(save({ locale: "en", machineState: "results" }));
    saveQuizProgress(save({ locale: "en", session: daily, theme: "daily", questionIndex: 3 }));

    expect(findOtherLocaleRound("pt-BR", "2099-01-01")).toBeNull();
    expect(findOtherLocaleRound("pt-BR", DAY)).toMatchObject({ theme: "daily", question_index: 3 });
  });
});

describe("otherLocaleRoundHref", () => {
  it("opens the round's language on the URL params that select its slot", () => {
    expect(otherLocaleRoundHref(save({ locale: "en" }), "/")).toBe("/en/?mode=standard&theme=history");
    expect(otherLocaleRoundHref(save({ session: daily, theme: "daily", playMode: "assisted" }), "/kpop-quiz/"))
      .toBe("/kpop-quiz/pt-br/?mode=assisted&theme=daily");
    expect(otherLocaleRoundHref(save({ locale: "en", decades: [2010, 2000] }), "/"))
      .toBe("/en/?mode=standard&theme=history&decade=2000&decade=2010");
  });
});
