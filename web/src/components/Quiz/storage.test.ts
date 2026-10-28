import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import {
  buildQuizProgressEnvelope,
  buildQuizProgressSave,
  checkQuizProgressCompatibility,
  clearQuizProgress,
  expandHistory,
  loadQuizProgressSave,
  parseQuizProgressSave,
  QUIZ_PROGRESS_SCHEMA,
  QUIZ_PROGRESS_STORAGE_KEY,
  saveQuizProgress,
} from "./storage";
import type { QuizSession } from "../../lib/quiz-types";

const session = ptSession as QuizSession;

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

  it("round-trips a valid save through localStorage", () => {
    const save = baseSave();
    expect(saveQuizProgress(save)).toBe("ok");
    const loaded = loadQuizProgressSave();
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.save.session_id).toBe(session.session_id);
    expect(loaded.save.history).toHaveLength(1);
    expect(expandHistory(loaded.save.history, session)?.[0]?.question.id).toBe(session.questions[0]!.id);
  });

  it("rejects invalid JSON and wrong schema without throwing", () => {
    localStorage.setItem(QUIZ_PROGRESS_STORAGE_KEY, "{");
    expect(loadQuizProgressSave()).toEqual({ status: "invalid" });

    localStorage.setItem(QUIZ_PROGRESS_STORAGE_KEY, JSON.stringify({ schema_version: "nope" }));
    expect(loadQuizProgressSave()).toEqual({ status: "invalid" });

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
    expect(loadQuizProgressSave()).toEqual({ status: "unavailable" });
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

  it("clears the progress key", () => {
    saveQuizProgress(baseSave());
    expect(clearQuizProgress()).toBe("ok");
    expect(loadQuizProgressSave()).toEqual({ status: "missing" });
  });
});
