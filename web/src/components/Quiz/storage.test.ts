import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import {
  buildQuizProgressEnvelope,
  buildQuizProgressSave,
  checkQuizProgressCompatibility,
  clearQuizProgress,
  expandHistory,
  listQuizProgressSaves,
  loadQuizProgressSave,
  loadStoredPreferences,
  parseQuizProgressSave,
  QUIZ_PROGRESS_LEGACY_STORAGE_KEY,
  QUIZ_PROGRESS_SCHEMA,
  QUIZ_PROGRESS_STORAGE_BUDGET_NOTE,
  quizProgressConfigKey,
  quizProgressSlotId,
  quizProgressStorageKey,
  peekQuizProgressSave,
  saveQuizProgress,
  saveStoredPlayMode,
  saveStoredTimerEnabled,
} from "./storage";
import { throwOnLocalStorage } from "../../test/throwing-storage";
import type { QuizSession } from "../../lib/quiz-types";
import { guardAfterChange, guardRows, type GuardCase } from "../../test/guard-table";

const session = ptSession as QuizSession;

const ptConfig = {
  locale: "pt-BR" as const,
  playMode: "standard" as const,
  theme: "history" as const,
  decades: [] as [],
};

const enConfig = {
  locale: "en" as const,
  playMode: "standard" as const,
  theme: "history" as const,
  decades: [] as [],
};

function baseSave(overrides: Record<string, unknown> = {}) {
  const history = [
    {
      question: session.questions[0]!,
      selectedOptionId: session.questions[0]!.options[0]!.id,
      isCorrect: false,
      cluesUsedCount: 0,
    },
  ];
  return buildQuizProgressSave({
    session,
    sessionSource: "published",
    locale: "pt-BR",
    playMode: "standard",
    theme: "history",
    decades: [],
    timerEnabled: true,
    machineState: "question.ready",
    questionIndex: 1,
    selectedId: null,
    timedOut: false,
    score: 0,
    revealedClues: [],
    history,
    questionDeadlineMs: Date.now() + 15_000,
    startedAtMs: Date.now() - 30_000,
    elapsedSeconds: 0,
    gaveUp: false,
    replayNotice: "legacy-repeats",
    ...overrides,
  });
}

describe("quiz progress storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds an additive envelope with optional catalog_version", () => {
    const published = buildQuizProgressEnvelope(session, "published");
    expect(published).toEqual({
      schema_version: QUIZ_PROGRESS_SCHEMA,
      session_id: session.session_id,
      dataset_version: session.dataset_version,
      session_source: "published",
    });

    const withCatalog = {
      ...session,
      catalog_version: "a".repeat(64),
    } as QuizSession;
    const catalog = buildQuizProgressEnvelope(withCatalog, "catalog");
    expect(catalog.catalog_version).toBe("a".repeat(64));
  });

  it("derives a stable per-config slot id from the requestKey shape", () => {
    const key = quizProgressConfigKey(ptConfig);
    expect(key).toBe("pt-BR|standard|history|");
    expect(quizProgressSlotId(key)).toMatch(/^[0-9a-f]{16}$/);
    expect(quizProgressStorageKey(ptConfig)).toBe(
      `kpop-quiz-progress:${quizProgressSlotId(key)}`,
    );
    expect(quizProgressStorageKey(ptConfig)).not.toBe(quizProgressStorageKey(enConfig));
    expect(QUIZ_PROGRESS_STORAGE_BUDGET_NOTE).toMatch(/5 MiB/);
  });

  it("round-trips a valid save through the per-config slot", () => {
    const save = baseSave();
    expect(saveQuizProgress(save)).toBe("ok");
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(quizProgressStorageKey(ptConfig))).toBeTruthy();
    const loaded = loadQuizProgressSave(ptConfig);
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.save.session_id).toBe(session.session_id);
    expect(loaded.save.history).toHaveLength(1);
    expect(expandHistory(loaded.save.history, session)?.[0]?.question.id).toBe(session.questions[0]!.id);
  });

  it("keeps separate slots for different locales and does not clear the other", () => {
    const ptSave = baseSave({ locale: "pt-BR" });
    const enSession = {
      ...session,
      session_id: "e".repeat(64),
      language: "en",
    } as QuizSession;
    // Build a minimal en-labelled save that still parses: reuse pt session bytes
    // but mark locale en for slot routing (compat against a live en session is separate).
    const enSave = baseSave({
      locale: "en",
      session: session,
      session_id: session.session_id,
    });
    expect(saveQuizProgress(ptSave)).toBe("ok");
    expect(saveQuizProgress(enSave)).toBe("ok");
    expect(localStorage.getItem(quizProgressStorageKey(ptConfig))).toBeTruthy();
    expect(localStorage.getItem(quizProgressStorageKey(enConfig))).toBeTruthy();

    expect(clearQuizProgress(enConfig)).toBe("ok");
    expect(loadQuizProgressSave(enConfig)).toEqual({ status: "missing" });
    const stillPt = loadQuizProgressSave(ptConfig);
    expect(stillPt.status).toBe("ok");
    if (stillPt.status === "ok") {
      expect(stillPt.save.locale).toBe("pt-BR");
    }
    void enSession;
  });

  it("migrates a compatible legacy single-slot save into the config slot", () => {
    const save = baseSave();
    localStorage.setItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY, JSON.stringify(save));
    const loaded = loadQuizProgressSave(ptConfig);
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.save.session_id).toBe(session.session_id);
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(quizProgressStorageKey(ptConfig))).toBeTruthy();
  });

  it("leaves an incompatible legacy save in place and reports legacy-elsewhere", () => {
    const ptSave = baseSave({ locale: "pt-BR" });
    localStorage.setItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY, JSON.stringify(ptSave));
    // Seed an unrelated per-config slot that must survive.
    const other = baseSave({
      locale: "en",
      playMode: "assisted",
      theme: "daily",
    });
    const otherKey = quizProgressStorageKey({
      locale: "en",
      playMode: "assisted",
      theme: "daily",
      decades: [],
    });
    localStorage.setItem(otherKey, JSON.stringify(other));

    const loaded = loadQuizProgressSave(enConfig);
    expect(loaded.status).toBe("legacy-elsewhere");
    if (loaded.status !== "legacy-elsewhere") return;
    expect(loaded.save.locale).toBe("pt-BR");
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeTruthy();
    expect(localStorage.getItem(otherKey)).toBeTruthy();
    expect(localStorage.getItem(quizProgressStorageKey(enConfig))).toBeNull();
  });

  it("rejects invalid JSON and wrong schema without throwing", () => {
    localStorage.setItem(quizProgressStorageKey(ptConfig), "{");
    expect(loadQuizProgressSave(ptConfig)).toEqual({ status: "invalid" });
    expect(localStorage.getItem(quizProgressStorageKey(ptConfig))).toBeNull();

    localStorage.setItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY, JSON.stringify({ schema_version: "nope" }));
    expect(loadQuizProgressSave(ptConfig)).toEqual({ status: "invalid" });
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeNull();

    expect(parseQuizProgressSave(null)).toBeNull();
  });

  it("marks storage unavailable when localStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveQuizProgress(baseSave())).toBe("unavailable");
    spy.mockRestore();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadQuizProgressSave(ptConfig)).toEqual({ status: "unavailable" });
  });

  it("reports every slot as unavailable or empty when localStorage throws", () => {
    localStorage.setItem(quizProgressStorageKey(ptConfig), JSON.stringify(baseSave()));
    throwOnLocalStorage();
    expect(loadQuizProgressSave(ptConfig)).toEqual({ status: "unavailable" });
    expect(peekQuizProgressSave(ptConfig)).toBeNull();
    expect(listQuizProgressSaves()).toEqual([]);
    expect(saveQuizProgress(baseSave())).toBe("unavailable");
    expect(clearQuizProgress(ptConfig)).toBe("unavailable");
    expect(loadStoredPreferences()).toEqual({ playMode: null, timerEnabled: null });
    expect(() => saveStoredPlayMode("expert")).not.toThrow();
    expect(() => saveStoredTimerEnabled(true)).not.toThrow();
  });

  it("accepts a compatible published save and rejects identity drift", () => {
    const save = baseSave();
    expect(
      checkQuizProgressCompatibility(save, {
        locale: "pt-BR",
        playMode: "standard",
        theme: "history",
        decades: [],
        session,
        sessionSource: "published",
      }),
    ).toBe("ok");

    expect(
      checkQuizProgressCompatibility(save, {
        locale: "en",
        playMode: "standard",
        theme: "history",
        decades: [],
        session,
        sessionSource: "published",
      }),
    ).toBe("incompatible");

    const otherSession = {
      ...session,
      session_id: "f".repeat(64),
    } as QuizSession;
    expect(
      checkQuizProgressCompatibility(save, {
        locale: "pt-BR",
        playMode: "standard",
        theme: "history",
        decades: [],
        session: otherSession,
        sessionSource: "published",
      }),
    ).toBe("incompatible");
  });

  it("requires matching catalog_version for catalog saves", () => {
    const catalogSession = {
      ...session,
      catalog_version: "b".repeat(64),
    } as QuizSession;
    const save = buildQuizProgressSave({
      session: catalogSession,
      sessionSource: "catalog",
      locale: "pt-BR",
      playMode: "standard",
      theme: "history",
      decades: [],
      timerEnabled: false,
      machineState: "results",
      questionIndex: catalogSession.questions.length - 1,
      selectedId: null,
      timedOut: false,
      score: 10,
      revealedClues: [],
      history: catalogSession.questions.map((question) => ({
        question,
        selectedOptionId: null,
        isCorrect: false,
        cluesUsedCount: 0,
      })),
      questionDeadlineMs: null,
      startedAtMs: 1,
      elapsedSeconds: 40,
      gaveUp: false,
      replayNotice: "ok",
    });

    expect(
      checkQuizProgressCompatibility(save, {
        locale: "pt-BR",
        playMode: "standard",
        theme: "history",
        decades: [],
        session: catalogSession,
        sessionSource: "catalog",
        catalogVersion: "b".repeat(64),
      }),
    ).toBe("ok");

    expect(
      checkQuizProgressCompatibility(save, {
        locale: "pt-BR",
        playMode: "standard",
        theme: "history",
        decades: [],
        session: catalogSession,
        sessionSource: "catalog",
        catalogVersion: "c".repeat(64),
      }),
    ).toBe("incompatible");
  });

  it("clears only the requested config slot", () => {
    saveQuizProgress(baseSave());
    saveQuizProgress(baseSave({ locale: "en" }));
    expect(clearQuizProgress(ptConfig)).toBe("ok");
    expect(loadQuizProgressSave(ptConfig)).toEqual({ status: "missing" });
    expect(loadQuizProgressSave(enConfig).status).toBe("ok");
  });

  it("does not erase a foreign legacy save when writing another config slot", () => {
    const ptLegacy = baseSave({ locale: "pt-BR" });
    localStorage.setItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY, JSON.stringify(ptLegacy));
    expect(saveQuizProgress(baseSave({ locale: "en" }))).toBe("ok");
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeTruthy();
    expect(loadQuizProgressSave(enConfig).status).toBe("ok");
    // EN visit without loading PT still sees the foreign legacy.
    expect(loadQuizProgressSave(enConfig)).toEqual(
      expect.objectContaining({ status: "ok" }),
    );
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeTruthy();
    // PT later adopts the legacy into its own slot.
    expect(loadQuizProgressSave(ptConfig).status).toBe("ok");
    expect(localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(quizProgressStorageKey(ptConfig))).toBeTruthy();
  });
});

const HASH_B = "b".repeat(64);
const isParsedSave = (value: unknown) => parseQuizProgressSave(value) !== null;

/** Turns the save into a catalog round of `catalogVersion`. */
const asCatalogRound = (save: any, catalogVersion = HASH_B) => {
  save.session_source = "catalog";
  save.catalog_version = catalogVersion;
  save.session.catalog_version = catalogVersion;
};

// The fixture save waits on question 2 of a published round, with question 1 answered.
const PROGRESS_SAVE_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["an extra key", (s) => { s.extra = 1; }, true],
  ["another schema", (s) => { s.schema_version = "kpop-quiz-progress-v2"; }, false],
  ["an empty session id", (s) => { s.session_id = ""; }, false],
  ["a numeric session id", (s) => { s.session_id = 1; }, false],
  ["an empty dataset version", (s) => { s.dataset_version = ""; }, false],
  ["a session id other than the session's", (s) => { s.session_id = HASH_B; }, false],
  ["a dataset version other than the session's", (s) => { s.dataset_version = HASH_B; }, false],
  ["an unknown session source", (s) => { s.session_source = "imported"; }, false],
  ["a catalog version on a published round", (s) => { s.catalog_version = HASH_B; }, false],
  ["an empty catalog version", (s) => { s.catalog_version = ""; }, false],
  ["a catalog round", (s) => { asCatalogRound(s); }, true],
  ["a catalog round whose version is not a hash", (s) => { asCatalogRound(s, "b"); }, false],
  ["a catalog round without version", (s) => { asCatalogRound(s); delete s.catalog_version; }, false],
  ["a catalog round whose session has another version", (s) => { asCatalogRound(s); s.session.catalog_version = "c".repeat(64); }, false],
  ["an unknown locale", (s) => { s.locale = "fr"; }, false],
  ["an unknown play mode", (s) => { s.play_mode = "casual"; }, false],
  ["an unknown theme", (s) => { s.theme = "members"; }, false],
  ["a decade", (s) => { s.decades = [2000]; }, true],
  ["an unknown decade", (s) => { s.decades = [1980]; }, false],
  ["decades that are not a list", (s) => { s.decades = 2000; }, false],
  ["a timer flag as text", (s) => { s.timer_enabled = "true"; }, false],
  ["a session that is not valid", (s) => { s.session = {}; }, false],
  ["an unknown machine state", (s) => { s.machine_state = "intro"; }, false],
  ["the answered state", (s) => { s.machine_state = "question.answered"; s.question_index = 0; }, true],
  ["question index -1", (s) => { s.question_index = -1; }, false],
  ["a fractional question index", (s) => { s.question_index = 1.5; }, false],
  ["a question index past the history", (s) => { s.question_index = 2; }, false],
  ["a numeric selection", (s) => { s.selected_id = 1; }, false],
  ["a selection outside the options", (s) => { s.selected_id = HASH_B; }, false],
  ["a selection among the options", (s) => { s.selected_id = s.session.questions[1].options[0].id; }, true],
  ["a timeout flag as text", (s) => { s.timed_out = "no"; }, false],
  ["a negative score", (s) => { s.score = -5; }, true],
  ["an infinite score", (s) => { s.score = Infinity; }, false],
  ["a score as text", (s) => { s.score = "1"; }, false],
  ["revealed clues that are not a list", (s) => { s.revealed_clues = "x"; }, false],
  ["an empty revealed clue", (s) => { s.revealed_clues = [""]; }, false],
  ["a revealed clue the question lacks", (s) => { s.revealed_clues = ["x"]; }, false],
  ["history that is not a list", (s) => { s.history = {}; }, false],
  ["a history entry without question", (s) => { s.history[0].question_id = ""; }, false],
  ["a history entry for another question", (s) => { s.history[0].question_id = s.session.questions[1].id; }, false],
  ["a history entry with a numeric choice", (s) => { s.history[0].selected_option_id = 1; }, false],
  ["a history entry with a choice outside the options", (s) => { s.history[0].selected_option_id = HASH_B; }, false],
  ["a history entry without choice", (s) => { s.history[0].selected_option_id = null; }, true],
  ["a history entry with a result as text", (s) => { s.history[0].is_correct = "no"; }, false],
  ["a history entry with -1 clues", (s) => { s.history[0].clues_used_count = -1; }, false],
  ["a history entry with fractional clues", (s) => { s.history[0].clues_used_count = 0.5; }, false],
  ["a history entry with an extra key", (s) => { s.history[0].extra = 1; }, true],
  ["no deadline", (s) => { s.question_deadline_ms = null; }, true],
  ["a deadline as text", (s) => { s.question_deadline_ms = "1"; }, false],
  ["an infinite deadline", (s) => { s.question_deadline_ms = Infinity; }, false],
  ["a start time as text", (s) => { s.started_at_ms = "1"; }, false],
  ["a negative start time", (s) => { s.started_at_ms = -1; }, true],
  ["negative elapsed seconds", (s) => { s.elapsed_seconds = -1; }, false],
  ["fractional elapsed seconds", (s) => { s.elapsed_seconds = 0.5; }, true],
  ["a give-up flag as number", (s) => { s.gave_up = 1; }, false],
  ["replay notice ok", (s) => { s.replay_notice = "ok"; }, true],
  ["replay notice repeats", (s) => { s.replay_notice = "repeats"; }, true],
  ["no replay notice", (s) => { s.replay_notice = null; }, true],
  ["an unknown replay notice", (s) => { s.replay_notice = "fresh"; }, false],
];

describe("parseQuizProgressSave fields", () => {
  it.each(guardRows(PROGRESS_SAVE_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(baseSave(), change, isParsedSave)).toBe(accepted);
  });

  it.each([null, [], "save"])("refuses %j", (value) => {
    expect(parseQuizProgressSave(value)).toBeNull();
  });
});
