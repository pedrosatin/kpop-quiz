import { afterEach, describe, expect, it, vi } from "vitest";
import dailyPtSession from "../../tests/fixtures/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import { CatalogArtifactError, type QuizCatalog } from "../../data/catalog-loader";
import { CatalogSelectionError } from "../../data/catalog-session";
import { QuizArtifactError } from "../../data/session-loader";
import type { Locale, PlayMode, QuizSession } from "../../lib/quiz-types";
import { dailySeedDate } from "./daily-seed";
import { checkOtherLocaleSaveCompatibility, findFinishedDailySave, findOtherLocaleRound } from "./saved-rounds";
import {
  buildQuizProgressSave,
  listQuizProgressSaves,
  QUIZ_PROGRESS_STORAGE_PREFIX,
  quizProgressStorageKey,
  saveQuizProgress,
} from "./storage";
import type { QuizTheme } from "./url-params";
import { otherLocaleRoundHref } from "./useOtherLocaleRound";

vi.mock("../../data/session-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/session-loader")>();
  return {
    ...actual,
    loadQuizSessionWithAvailability: vi.fn(),
  };
});

vi.mock("../../data/catalog-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/catalog-loader")>();
  return {
    ...actual,
    loadQuizCatalog: vi.fn(),
  };
});

vi.mock("../../data/catalog-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/catalog-session")>();
  return {
    ...actual,
    buildCatalogSession: vi.fn(),
  };
});

import { loadQuizCatalog } from "../../data/catalog-loader";
import { buildCatalogSession } from "../../data/catalog-session";
import { loadQuizSessionWithAvailability } from "../../data/session-loader";

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
  sessionSource = "published",
}: {
  session?: QuizSession;
  locale?: Locale;
  playMode?: PlayMode;
  theme?: QuizTheme;
  machineState?: "question.ready" | "results";
  questionIndex?: number;
  startedAtMs?: number;
  decades?: (1990 | 2000 | 2010 | 2020)[];
  sessionSource?: "catalog" | "published";
} = {}) {
  const answered = machineState === "results" ? session.questions.length : questionIndex;
  return buildQuizProgressSave({
    session,
    sessionSource,
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

const CATALOG_VERSION = "catalog-test-v1";

function catalogSession(base: QuizSession = general): QuizSession {
  const session = structuredClone(base) as QuizSession;
  session.catalog_version = CATALOG_VERSION;
  return session;
}

function catalogFixture(session: QuizSession): QuizCatalog {
  return {
    catalogVersion: CATALOG_VERSION,
    datasetVersion: session.dataset_version,
    referenceDate: session.questions[0]!.reference_date,
    locale: session.config.language,
    playMode: session.config.play_mode,
    questions: session.questions,
    pools: {
      all: session.questions.map((_, index) => index),
      "decade.1990": [],
      "decade.2000": [],
      "decade.2010": [],
      "decade.2020": [],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("listQuizProgressSaves", () => {
  it("reads every valid slot and leaves the others alone", () => {
    saveQuizProgress(save());
    saveQuizProgress(save({ locale: "en", playMode: "expert" }));
    window.localStorage.setItem(`${QUIZ_PROGRESS_STORAGE_PREFIX}broken`, "{not json");
    window.localStorage.setItem("kpop-player-stats-v1", "{}");

    expect(listQuizProgressSaves().map((s) => `${s.locale}|${s.play_mode}`).sort()).toEqual(["en|expert", "pt-BR|standard"]);
    expect(window.localStorage.getItem(`${QUIZ_PROGRESS_STORAGE_PREFIX}broken`)).toBe("{not json");
  });

  it("lists nothing when a read fails after an earlier one succeeded", () => {
    saveQuizProgress(save());
    saveQuizProgress(save({ locale: "en", playMode: "expert" }));
    const getItem = Storage.prototype.getItem;
    let reads = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      reads += 1;
      if (reads > 1) throw new DOMException("The operation is insecure.", "SecurityError");
      return getItem.call(this, key);
    });

    expect(listQuizProgressSaves()).toEqual([]);
    expect(reads).toBe(2);
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
  const published = { session_id: daily.session_id, dataset_version: daily.dataset_version };

  it("prefers the mode in use among saves that match the published session", () => {
    saveQuizProgress(save({ session: daily, theme: "daily", machineState: "results", playMode: "standard" }));
    expect(findFinishedDailySave("pt-BR", DAY, "standard", published)?.play_mode).toBe("standard");
  });

  it("ignores a finished save from an earlier board of the same date", () => {
    const oldBoard = structuredClone(daily) as QuizSession;
    oldBoard.session_id = "old-board-session";
    oldBoard.dataset_version = "old-board-dataset";
    saveQuizProgress(save({
      session: oldBoard,
      theme: "daily",
      machineState: "results",
      playMode: "expert",
    }));

    expect(findFinishedDailySave("pt-BR", DAY, "standard", published)).toBeNull();
    expect(findFinishedDailySave("pt-BR", DAY, "expert", published)).toBeNull();
  });

  it("ignores rounds in progress, other dates, the general quiz and the other language", () => {
    saveQuizProgress(save({ session: daily, theme: "daily", questionIndex: 2 }));
    saveQuizProgress(save({ session: general, machineState: "results" }));
    saveQuizProgress(save({ session: daily, theme: "daily", machineState: "results", locale: "en" }));

    expect(findFinishedDailySave("pt-BR", DAY, "standard", published)).toBeNull();
    expect(findFinishedDailySave("pt-BR", "2099-01-01", "standard", published)).toBeNull();
  });
});

describe("checkOtherLocaleSaveCompatibility", () => {
  const loadLive = vi.mocked(loadQuizSessionWithAvailability);
  const loadCatalog = vi.mocked(loadQuizCatalog);
  const buildCatalog = vi.mocked(buildCatalogSession);

  it("returns ok when the live published session still matches the save", async () => {
    const live = structuredClone(general) as QuizSession;
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 2 });
    loadLive.mockResolvedValue({ session: live, availableDecades: [], decades: [] });

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("ok");
    expect(loadLive).toHaveBeenCalledWith("en", "standard", "history", undefined, []);
  });

  it("returns incompatible when the live session id drifted", async () => {
    const live = structuredClone(general) as QuizSession;
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 2 });
    const drifted = structuredClone(live) as QuizSession;
    drifted.session_id = "b".repeat(64);
    loadLive.mockResolvedValue({ session: drifted, availableDecades: [], decades: [] });

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("incompatible");
  });

  it("returns ok when a non-daily catalog save still matches the live catalog", async () => {
    const live = catalogSession();
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 2, sessionSource: "catalog" });
    const catalog = catalogFixture(live);
    loadCatalog.mockResolvedValue(catalog);
    buildCatalog.mockResolvedValue(live);

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("ok");
    expect(loadCatalog).toHaveBeenCalledWith("en", "standard");
    expect(buildCatalog).toHaveBeenCalledWith(catalog, live.questions, []);
    expect(loadLive).not.toHaveBeenCalled();
  });

  it("returns incompatible when a catalog question left the live catalog", async () => {
    const live = catalogSession();
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 2, sessionSource: "catalog" });
    const full = catalogFixture(live);
    loadCatalog.mockResolvedValue({
      ...full,
      questions: live.questions.slice(1),
      pools: {
        ...full.pools,
        all: live.questions.slice(1).map((_, index) => index),
      },
    });

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("incompatible");
    expect(buildCatalog).not.toHaveBeenCalled();
  });

  it("maps a missing published artifact to incompatible", async () => {
    const enSave = save({
      session: { ...structuredClone(general) as QuizSession, config: { ...general.config, language: "en" } },
      locale: "en",
      questionIndex: 1,
    });
    loadLive.mockRejectedValue(new QuizArtifactError("missing"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("incompatible");
  });

  it("maps an invalid published artifact to invalid", async () => {
    const enSave = save({
      session: { ...structuredClone(general) as QuizSession, config: { ...general.config, language: "en" } },
      locale: "en",
      questionIndex: 1,
    });
    loadLive.mockRejectedValue(new QuizArtifactError("invalid"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("invalid");
  });

  it("maps a missing catalog artifact to incompatible", async () => {
    const live = catalogSession();
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 1, sessionSource: "catalog" });
    loadCatalog.mockRejectedValue(new CatalogArtifactError("missing", "manifest not published"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("incompatible");
  });

  it("maps an invalid catalog artifact to invalid", async () => {
    const live = catalogSession();
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 1, sessionSource: "catalog" });
    loadCatalog.mockRejectedValue(new CatalogArtifactError("invalid", "shard hash"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("invalid");
  });

  it("maps an unavailable catalog selection to incompatible", async () => {
    const live = catalogSession();
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 1, sessionSource: "catalog" });
    loadCatalog.mockResolvedValue(catalogFixture(live));
    buildCatalog.mockRejectedValue(new CatalogSelectionError("unavailable", "not enough questions"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("incompatible");
  });

  it("maps an invalid catalog selection to invalid", async () => {
    const live = catalogSession();
    live.config = { ...live.config, language: "en" };
    const enSave = save({ session: live, locale: "en", questionIndex: 1, sessionSource: "catalog" });
    loadCatalog.mockResolvedValue(catalogFixture(live));
    buildCatalog.mockRejectedValue(new CatalogSelectionError("invalid", "bad selection"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).resolves.toBe("invalid");
  });

  it("rethrows a network or TypeError from the live load", async () => {
    const enSave = save({
      session: { ...structuredClone(general) as QuizSession, config: { ...general.config, language: "en" } },
      locale: "en",
      questionIndex: 1,
    });
    loadLive.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(checkOtherLocaleSaveCompatibility(enSave)).rejects.toThrow(TypeError);
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
