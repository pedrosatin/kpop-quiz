import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "../../i18n/catalog";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";
import { isGameMatchRecorded, loadPlayerStats, recordGameFinish, recordMatchOnce } from "../../lib/player-stats";
import type { QuizSession } from "../../lib/quiz-types";
import { clearCatalogCache } from "../../data/catalog-loader";
import { CatalogSelectionError, selectCatalogRound } from "../../data/catalog-session";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import enSession from "../../tests/fixtures/session.en.standard.9c44914efa4be2eee52cf11ea63f542c8e913e01b5a58dc63d3627ed003e8c0e.json";
import dailyPtSession from "../../tests/fixtures/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";
import manifest from "../../tests/fixtures/manifest-v2.json";
import { NEXT_GUARD_MS } from "./AnswerFeedback";
import { dailySeedDate } from "./daily-seed";
import { formatCalendarDate } from "../../lib/format-date";
import { dayAfter, onDay } from "../../test/stale-daily";
import { Quiz } from "./Quiz";
import {
  buildQuizProgressSave,
  QUIZ_PROGRESS_LEGACY_STORAGE_KEY,
  quizProgressStorageKey,
  saveQuizProgress,
} from "./storage";

// Replay, resume and failure paths of the whole component: what the player
// sees, what lands in localStorage and which analytics events fire.

const selection = vi.hoisted(() => ({ failure: null as Error | null }));

vi.mock("../../data/catalog-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/catalog-session")>();
  return {
    ...actual,
    selectCatalogRound: vi.fn((options: Parameters<typeof actual.selectCatalogRound>[0]) =>
      selection.failure ? Promise.reject(selection.failure) : actual.selectCatalogRound(options)),
  };
});

const CATALOG_DIR = path.resolve(__dirname, "../../tests/fixtures/catalog");
const catalogManifest = fs.readFileSync(path.join(CATALOG_DIR, "catalog-manifest-v1.json"), "utf-8");
const catalogFiles = new Map(fs.readdirSync(CATALOG_DIR).map((name) => [name, fs.readFileSync(path.join(CATALOG_DIR, name))]));
const dailyRaw = `${JSON.stringify(dailyPtSession)}\n`;
const dailyHash = createHash("sha256").update(dailyRaw).digest("hex");

/**
 * Today's challenge in another language or mode: the Portuguese standard
 * fixture relabelled, so each daily slot has a session of the same date.
 */
function dailyVariant(locale: "pt-BR" | "en", playMode: "standard" | "assisted") {
  const session = structuredClone(dailyPtSession) as QuizSession;
  session.config = { ...session.config, language: locale, play_mode: playMode };
  session.questions = session.questions.map((question) => ({ ...question, language: locale, play_mode: playMode }));
  session.session_id = createHash("sha256").update(`${dailyPtSession.session_id}|${locale}|${playMode}`).digest("hex");
  const raw = `${JSON.stringify(session)}\n`;
  return { session, raw, hash: createHash("sha256").update(raw).digest("hex") };
}
const dailyVariants = {
  "pt-BR.assisted": dailyVariant("pt-BR", "assisted"),
  "en.standard": dailyVariant("en", "standard"),
} as const;
const ptRaw = `${JSON.stringify(ptSession)}\n`;
const ptHash = createHash("sha256").update(ptRaw).digest("hex");
const messages = getMessages("pt-BR");
const historyConfig = { locale: "pt-BR", playMode: "standard", theme: "history", decades: [] } as const;
const historySlot = quizProgressStorageKey({ ...historyConfig, decades: [] });
const dailySlot = quizProgressStorageKey({ ...historyConfig, theme: "daily", decades: [] });

type CatalogWorld = "published" | "missing" | "corrupt" | "held";
type SessionsWorld = "published" | "missing" | "network-error";
/** "undated" serves the general session as the daily one, so its seed has no date. */
type DailyWorld = "dated" | "undated";

const world: { catalog: CatalogWorld; sessions: SessionsWorld; daily: DailyWorld; held: (() => void)[] } = {
  catalog: "published",
  sessions: "published",
  daily: "dated",
  held: [],
};

function catalogResponse(name: string): Response {
  if (world.catalog === "missing") return new Response(null, { status: 404 });
  if (world.catalog === "corrupt") return new Response("not json");
  if (name === "catalog-manifest-v1.json") return new Response(catalogManifest);
  return new Response(new Uint8Array(catalogFiles.get(name)!));
}

function sessionResponse(url: string, sessionsManifest: unknown): Response {
  if (world.sessions === "missing") return new Response(null, { status: 404 });
  if (world.sessions === "network-error") throw new TypeError("offline");
  if (url.endsWith("manifest-v3.json")) return new Response(null, { status: 404 });
  if (url.endsWith("manifest-v2.json")) return new Response(JSON.stringify(sessionsManifest));
  if (url.includes("session.daily") && world.daily === "dated") {
    const variant = Object.values(dailyVariants).find(({ hash }) => url.includes(hash));
    return new Response(variant?.raw ?? dailyRaw);
  }
  return new Response(ptRaw);
}

function buildSessionsManifest() {
  const sessions = structuredClone(manifest) as Record<string, any>;
  const [hash, sessionId] = world.daily === "dated"
    ? [dailyHash, dailyPtSession.session_id]
    : [ptHash, ptSession.session_id];
  sessions.sessions["daily.pt-BR.standard"] = {
    path: `session.daily.pt-BR.standard.${hash}.json`,
    sha256: hash,
    session_id: sessionId,
  };
  if (world.daily === "dated") {
    for (const [key, variant] of Object.entries(dailyVariants)) {
      sessions.sessions[`daily.${key}`] = {
        path: `session.daily.${key}.${variant.hash}.json`,
        sha256: variant.hash,
        session_id: variant.session.session_id,
      };
    }
  }
  return sessions;
}

function serveData() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = url.split("/data/")[1] ?? "";
    if (!name.startsWith("catalog")) return sessionResponse(url, buildSessionsManifest());
    if (world.catalog === "held") {
      await new Promise<void>((resolve) => { world.held.push(resolve); });
      world.catalog = "published";
    }
    return catalogResponse(name);
  }));
}

let now = 1_000;

async function waitForSetup() {
  await screen.findByRole("heading", { name: "Monte sua partida" });
  await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
}

async function renderSetup() {
  render(<Quiz locale="pt-BR" />);
  await waitForSetup();
}

function startRound() {
  fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
}

async function playToResults(total = 10) {
  for (let index = 0; index < total; index += 1) {
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    now += NEXT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: index === total - 1 ? "Ver resultado" : "Próxima pergunta" }));
  }
  await screen.findByRole("heading", { name: "Fim da partida" });
}

function restart() {
  fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
}

async function waitForQuestion() {
  await screen.findByRole("button", { name: "Responder" });
  await act(async () => { await Promise.resolve(); });
}

const readSlot = (key = historySlot) => {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw) as Record<string, unknown>;
};

function roundSave(
  session: QuizSession,
  sessionSource: "catalog" | "published",
  overrides: Partial<Parameters<typeof buildQuizProgressSave>[0]> = {},
) {
  return buildQuizProgressSave({
    session,
    sessionSource,
    ...historyConfig,
    decades: [],
    timerEnabled: false,
    machineState: "question.ready",
    questionIndex: 0,
    selectedId: null,
    timedOut: false,
    score: 0,
    revealedClues: [],
    history: [],
    questionDeadlineMs: null,
    startedAtMs: Date.now() - 5_000,
    elapsedSeconds: 0,
    gaveUp: false,
    replayNotice: null,
    ...overrides,
  });
}

function drawCatalogRound() {
  return selectCatalogRound({ locale: "pt-BR", playMode: "standard", decades: [], avoidPrevious: false, baseUrl: "/" });
}

const notice = () => screen.getByTestId("quiz-replay-notice");

// The loader takes the dated daily session as today's only on its own date.
function onDailyDate() {
  onDay(dailySeedDate(dailyPtSession as QuizSession)!);
}

describe("Quiz flows", () => {
  const gtag = vi.fn();
  const trackedEvents = () => gtag.mock.calls.map((call) => call[1]);

  beforeEach(() => {
    // A visit with no theme opens today's challenge; these cases play the
    // general quiz unless they set their own URL.
    window.history.replaceState(null, "", "/?theme=history");
    vi.spyOn(performance, "now").mockImplementation(() => now);
    world.catalog = "published";
    world.sessions = "published";
    world.daily = "dated";
    world.held = [];
    selection.failure = null;
    vi.mocked(selectCatalogRound).mockClear();
    gtag.mockClear();
    vi.stubGlobal("gtag", gtag);
    setGameAnalyticsConsent("G-TEST", true);
    clearCatalogCache();
    serveData();
  });

  afterEach(() => {
    setGameAnalyticsConsent("", false);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    clearCatalogCache();
  });

  describe("replay", () => {
    it("draws another catalog round, focuses its first question and saves it", async () => {
      await renderSetup();
      startRound();
      const firstPrompt = (await screen.findByRole("heading", { level: 2 })).textContent;
      await playToResults();

      restart();
      await waitForQuestion();

      const heading = screen.getByRole("heading", { level: 2 });
      expect(heading.textContent).not.toBe(firstPrompt);
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));
      expect(readSlot()).toMatchObject({
        machine_state: "question.ready",
        session_source: "catalog",
        question_index: 0,
        history: [],
        score: 0,
        gave_up: false,
        replay_notice: "ok",
      });
      expect(trackedEvents()).toEqual(["game_start", "game_complete", "game_start"]);
    });

    it("falls back to the published session with the legacy notice when the catalog is gone", async () => {
      await renderSetup();
      startRound();
      await playToResults();

      world.catalog = "missing";
      clearCatalogCache();
      restart();
      const heading = await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt });
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));

      expect(readSlot()).toMatchObject({
        machine_state: "question.ready",
        session_source: "published",
        replay_notice: "legacy-repeats",
        question_index: 0,
      });
      expect(trackedEvents()).toEqual(["game_start", "game_complete", "game_start"]);
    });

    it.each([
      ["missing", "missing", messages.artifactMissing],
      ["unreachable", "network-error", messages.artifactInvalid],
    ] as const)("shows the failure when the fallback session is %s", async (_label, sessions, text) => {
      await renderSetup();
      startRound();
      await playToResults();

      world.catalog = "missing";
      world.sessions = sessions;
      clearCatalogCache();
      restart();

      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByTestId("game-missing")).toHaveAttribute(
        "data-error-kind", sessions === "missing" ? "missing" : "invalid",
      );
      expect(screen.getByTestId("game-retry")).toBeInTheDocument();
    });

    it("shows the invalid state for a corrupt catalog without falling back", async () => {
      await renderSetup();
      startRound();
      await playToResults();

      world.catalog = "corrupt";
      clearCatalogCache();
      restart();

      expect(await screen.findByText(messages.artifactInvalid)).toBeInTheDocument();
    });

    it("shows the invalid state when the draw fails for an unknown reason", async () => {
      await renderSetup();
      startRound();
      await playToResults();

      selection.failure = new Error("boom");
      restart();

      expect(await screen.findByText(messages.artifactInvalid)).toBeInTheDocument();
    });

    it("offers a retry when too few questions remain and draws again", async () => {
      await renderSetup();
      startRound();
      await playToResults();

      selection.failure = new CatalogSelectionError("unavailable", "too few");
      restart();
      expect(await screen.findByText(messages.quizReplayUnavailable)).toBeInTheDocument();

      selection.failure = null;
      vi.mocked(selectCatalogRound).mockClear();
      fireEvent.click(screen.getByRole("button", { name: messages.retry }));
      await waitForSetup();
      expect(selectCatalogRound).toHaveBeenCalled();
    });

    it("ends the daily session with the next daily game instead of a replay", async () => {
      onDailyDate();
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      startRound();
      await screen.findByRole("heading", { name: dailyPtSession.questions[0]!.prompt });
      await playToResults();

      expect(screen.queryByRole("button", { name: "Jogar novamente" })).toBeNull();
      expect(screen.getByRole("link", { name: /Próximo: Grade/ })).toHaveAttribute("href", "/pt-br/grid/");
      expect(screen.getByText(/^Novo desafio em \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    });

  });

  describe("resume", () => {
    it("restores a saved catalog round without drawing another", async () => {
      const round = await drawCatalogRound();
      const [first, second] = round.session.questions;
      saveQuizProgress(roundSave(round.session, "catalog", {
        questionIndex: 1,
        selectedId: second!.options[1]!.id,
        history: [{ question: first!, selectedOptionId: first!.options[0]!.id, isCorrect: false, cluesUsedCount: 0 }],
        replayNotice: "ok",
      }));
      vi.mocked(selectCatalogRound).mockClear();

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: second!.prompt })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: second!.options[1]!.label })).toBeChecked();
      expect(selectCatalogRound).not.toHaveBeenCalled();
      expect(trackedEvents()).toEqual([]);
    });

    it("restores a saved catalog round of one decade without drawing another", async () => {
      const decades = [2000] as const;
      const round = await selectCatalogRound({ locale: "pt-BR", playMode: "standard", decades, avoidPrevious: false, baseUrl: "/" });
      const [first, second] = round.session.questions;
      saveQuizProgress(roundSave(round.session, "catalog", {
        decades: [...decades],
        questionIndex: 1,
        selectedId: second!.options[1]!.id,
        history: [{ question: first!, selectedOptionId: first!.options[0]!.id, isCorrect: false, cluesUsedCount: 0 }],
        replayNotice: "ok",
      }));
      vi.mocked(selectCatalogRound).mockClear();
      window.history.replaceState(null, "", "/?decade=2000");

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: second!.prompt })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: second!.options[1]!.label })).toBeChecked();
      expect(selectCatalogRound).not.toHaveBeenCalled();
      expect(readSlot(quizProgressStorageKey({ ...historyConfig, decades: [...decades] }))).toMatchObject({
        session_id: round.session.session_id,
        question_index: 1,
      });
    });

    it("drops a save from an older catalog and warns on the fresh setup", async () => {
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave({ ...round.session, catalog_version: "0".repeat(64) }, "catalog"));

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeIncompatible);
      expect(readSlot()).toBeNull();
    });

    // Regression: a catalog save was checked only against itself, so a save
    // whose session id no longer matched its questions resumed silently.
    it("drops a catalog save whose session id the live catalog does not build", async () => {
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave({ ...round.session, session_id: "d".repeat(64) }, "catalog"));

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeIncompatible);
      expect(readSlot()).toBeNull();
    });

    it("drops a catalog save that names a question the live catalog does not have", async () => {
      const round = await drawCatalogRound();
      const [first, ...rest] = round.session.questions;
      const gone = { ...first!, id: "e".repeat(64) };
      saveQuizProgress(roundSave({ ...round.session, questions: [gone, ...rest] }, "catalog"));

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeIncompatible);
      expect(readSlot()).toBeNull();
    });

    it("drops a catalog save when the catalog is gone and offers the published round", async () => {
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave(round.session, "catalog"));
      world.catalog = "missing";
      clearCatalogCache();

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeIncompatible);
      expect(readSlot()).toBeNull();
      startRound();
      expect(await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument();
    });

    it("stops on a corrupt catalog instead of dropping the save", async () => {
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave(round.session, "catalog"));
      world.catalog = "corrupt";
      clearCatalogCache();

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByText(messages.artifactInvalid)).toBeInTheDocument();
      expect(readSlot()).not.toBeNull();
    });

    it("clears a catalog save whose identity does not match its own slot", async () => {
      const round = await drawCatalogRound();
      window.localStorage.setItem(historySlot, JSON.stringify(roundSave(round.session, "catalog", { decades: [2000] })));

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeInvalid);
      expect(readSlot()).toBeNull();
    });

    it("keeps a published save for this config when a catalog draw replaces it on screen", async () => {
      saveQuizProgress(roundSave(ptSession as QuizSession, "published"));

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeIncompatible);
      expect(readSlot()).toMatchObject({ session_source: "published" });
    });

    it("keeps a legacy save that belongs to another config and warns", async () => {
      window.localStorage.setItem(
        QUIZ_PROGRESS_LEGACY_STORAGE_KEY,
        JSON.stringify(roundSave(ptSession as QuizSession, "published", { playMode: "expert" })),
      );

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeIncompatible);
      expect(window.localStorage.getItem(QUIZ_PROGRESS_LEGACY_STORAGE_KEY)).not.toBeNull();
    });

    it("ignores a catalog check superseded by a mode change", async () => {
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave(round.session, "catalog"));
      world.catalog = "held";
      clearCatalogCache();

      render(<Quiz locale="pt-BR" />);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("radio", { name: /Especialista/ }));
      await vi.waitFor(() => expect(world.held).toHaveLength(2));
      const [releaseStale, releaseCurrent] = world.held.splice(0);
      await act(async () => {
        releaseCurrent!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await waitForSetup();

      // The superseded check answers last, when nothing can overwrite its effect.
      await act(async () => {
        releaseStale!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByRole("button", { name: "Responder" })).not.toBeInTheDocument();
      expect(readSlot()).not.toBeNull();
    });

    it("warns about unreadable storage and still offers a round", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizStorageUnavailable);
    });

    it("warns about unreadable storage on the daily quiz too", async () => {
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizStorageUnavailable);
    });

    it("clears an unreadable daily save and warns", async () => {
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      window.localStorage.setItem(dailySlot, "{");

      await renderSetup();

      expect(notice()).toHaveTextContent(messages.quizResumeInvalid);
      expect(readSlot(dailySlot)).toBeNull();
    });

    it("measures the round when the restored timer expires on the last question", async () => {
      const session = ptSession as QuizSession;
      const last = session.questions.length - 1;
      saveQuizProgress(roundSave(session, "published", {
        timerEnabled: true,
        questionIndex: last,
        questionDeadlineMs: Date.now() - 1_000,
        startedAtMs: Date.now() - 30_000,
        history: session.questions.slice(0, last).map((question) => ({
          question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0,
        })),
      }));
      world.catalog = "missing";

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByText("Acabou o tempo.")).toBeInTheDocument();
      now += NEXT_GUARD_MS;
      fireEvent.click(screen.getByRole("button", { name: "Ver resultado" }));
      await screen.findByRole("heading", { name: "Fim da partida" });

      const saved = readSlot()!;
      expect(saved).toMatchObject({ machine_state: "results", timed_out: true });
      expect(saved.history).toHaveLength(session.questions.length);
      expect(saved.elapsed_seconds as number).toBeGreaterThanOrEqual(29);
    });

    it("counts the days since the last game from the first answer of a resumed round", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
        recordGameFinish("quiz", true, "2026-11-08");
        const session = ptSession as QuizSession;
        const last = session.questions.length - 1;
        saveQuizProgress(roundSave(session, "published", {
          questionIndex: last,
          history: session.questions.slice(0, last).map((question) => ({
            question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0,
          })),
        }));
        world.catalog = "missing";
        render(<Quiz locale="pt-BR" />);
        await waitForQuestion();

        fireEvent.click(screen.getAllByRole("radio")[0]!);
        fireEvent.click(screen.getByRole("button", { name: "Responder" }));
        // The result opens the next day.
        vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
        now += NEXT_GUARD_MS;
        fireEvent.click(screen.getByRole("button", { name: "Ver resultado" }));
        await screen.findByRole("heading", { name: "Fim da partida" });

        await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_complete"]));
        expect(gtag.mock.calls[0]![2]).toMatchObject({ daily: "no", outcome: "loss", days_since_last: "1" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("player stats", () => {
    it("records a daily round with an undated seed on the Sao Paulo day, whatever the visitor's time zone", async () => {
      world.daily = "undated";
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      const zone = process.env.TZ;
      process.env.TZ = "Asia/Tokyo";
      vi.useFakeTimers({ toFake: ["Date"] });
      // 10:00 on 9 November in Tokyo, still 8 November in Sao Paulo.
      vi.setSystemTime(new Date("2026-11-09T01:00:00Z"));
      try {
        await renderSetup();
        startRound();
        await waitForQuestion();
        await playToResults();

        await vi.waitFor(() => expect(isGameMatchRecorded("quiz", "daily-2026-11-08")).toBe(true));
        expect(loadPlayerStats().games.quiz.lastPlayedDate).toBe("2026-11-08");
        expect(gtag.mock.calls[0]![2]).toMatchObject({ daily: "yes" });
      } finally {
        vi.useRealTimers();
        if (zone === undefined) delete process.env.TZ;
        else process.env.TZ = zone;
      }
    });
  });

  describe("daily session from an earlier day", () => {
    const sessionDate = dailySeedDate(dailyPtSession as QuizSession)!;
    const staleNotice = () => screen.getByTestId("stale-daily-notice");

    it("shows its date and counts no daily match when today's is not out", async () => {
      onDay(dayAfter(sessionDate));
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      expect(staleNotice()).toHaveTextContent(messages.staleDaily(formatCalendarDate(sessionDate, "pt-BR")));

      startRound();
      await waitForQuestion();
      await playToResults();

      expect(staleNotice()).toBeInTheDocument();
      expect(loadPlayerStats().games.quiz?.played ?? 0).toBe(0);
      await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_start", "game_complete"]));
      expect(gtag.mock.calls.map((call) => call[2].daily)).toEqual(["no", "no"]);
    });

    it("counts no daily match for a round resumed from a save", async () => {
      onDay(dayAfter(sessionDate));
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      const session = dailyPtSession as QuizSession;
      const last = session.questions.length - 1;
      saveQuizProgress(roundSave(session, "published", {
        theme: "daily",
        questionIndex: last,
        history: session.questions.slice(0, last).map((question) => ({
          question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0,
        })),
      }));
      render(<Quiz locale="pt-BR" />);
      await waitForQuestion();
      expect(staleNotice()).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole("radio")[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      now += NEXT_GUARD_MS;
      fireEvent.click(screen.getByRole("button", { name: "Ver resultado" }));
      await screen.findByRole("heading", { name: "Fim da partida" });

      expect(loadPlayerStats().games.quiz?.played ?? 0).toBe(0);
    });

    it("keeps today's session as the daily challenge", async () => {
      onDay(sessionDate);
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      expect(screen.queryByTestId("stale-daily-notice")).toBeNull();

      startRound();
      await waitForQuestion();
      await playToResults();

      expect(isGameMatchRecorded("quiz", `daily-${sessionDate}`)).toBe(true);
      await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_start", "game_complete"]));
      expect(gtag.mock.calls.map((call) => call[2].daily)).toEqual(["yes", "yes"]);
    });
  });

  describe("daily slot from one day to the next", () => {
    const sessionDate = dailySeedDate(dailyPtSession as QuizSession)!;
    const today = dailyPtSession as QuizSession;
    const dayBefore = (() => {
      const day = new Date(`${sessionDate}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 1);
      return day.toISOString().slice(0, 10);
    })();
    // Yesterday's challenge: its own seed date and id, as the daily slot held it.
    const yesterday = { ...today, session_id: "a".repeat(64), config: { ...today.config, seed: `kpop-daily-${dayBefore}` } } as QuizSession;
    const played = (session: QuizSession, count: number) => session.questions.slice(0, count).map((question) => ({
      question, selectedOptionId: question.options[0]!.id, isCorrect: question.options[0]!.id === question.answer_option_id, cluesUsedCount: 0,
    }));

    // Regression: the daily session id changes every day, so yesterday's save
    // failed the compatibility check and the setup told the player it could
    // not resume a game, on every first visit of the day.
    it("drops yesterday's daily save without a notice on a visit with no theme", async () => {
      onDay(sessionDate);
      window.history.replaceState(null, "", "/");
      saveQuizProgress(roundSave(yesterday, "published", { theme: "daily", questionIndex: 2, history: played(yesterday, 2) }));
      expect(readSlot(dailySlot)).not.toBeNull();

      await renderSetup();

      expect(screen.getByRole("radio", { name: /Quiz do dia/ })).toBeChecked();
      expect(screen.queryByTestId("quiz-replay-notice")).toBeNull();
      expect(screen.queryByText(messages.quizResumeIncompatible)).toBeNull();
      expect(readSlot(dailySlot)).toBeNull();
      startRound();
      expect(await screen.findByRole("heading", { name: today.questions[0]!.prompt })).toBeInTheDocument();
    });

    it("still restores today's daily result from its save", async () => {
      onDay(sessionDate);
      window.history.replaceState(null, "", "/");
      const total = today.questions.length;
      saveQuizProgress(roundSave(today, "published", {
        theme: "daily",
        machineState: "results",
        questionIndex: total - 1,
        history: played(today, total),
      }));

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: "Fim da partida" })).toBeInTheDocument();
      expect(screen.queryByText(messages.quizResumeIncompatible)).toBeNull();
      expect(readSlot(dailySlot)).toMatchObject({ session_id: today.session_id, machine_state: "results" });
    });
  });

  describe("general quiz saved in progress on a visit that opens today's challenge", () => {
    const generalCard = () => screen.getByRole("radio", { name: /Quiz geral/ });
    const generalText = () => generalCard().closest("label")!;

    async function saveGeneralAt(questionIndex: number, machineState: "question.ready" | "results" = "question.ready") {
      const round = await drawCatalogRound();
      const questions = round.session.questions;
      const count = machineState === "results" ? questions.length : questionIndex;
      saveQuizProgress(roundSave(round.session, "catalog", {
        machineState,
        questionIndex,
        history: questions.slice(0, count).map((question) => ({
          question, selectedOptionId: question.options[0]!.id, isCorrect: false, cluesUsedCount: 0,
        })),
        replayNotice: "ok",
      }));
      return round.session;
    }

    it("says on the general card where the round stopped, and picking it continues there", async () => {
      const session = await saveGeneralAt(3);
      window.history.replaceState(null, "", "/");

      await renderSetup();

      expect(screen.getByRole("radio", { name: /Quiz do dia/ })).toBeChecked();
      expect(generalText()).toHaveTextContent(messages.quizGeneralInProgress(4, 10));
      expect(screen.getByText("Você parou na pergunta 4 de 10. Escolha para continuar.")).toBeInTheDocument();
      expect(screen.queryByTestId("quiz-replay-notice")).toBeNull();

      fireEvent.click(generalCard());

      const heading = await screen.findByRole("heading", { name: session.questions[3]!.prompt });
      await vi.waitFor(() => expect(heading).toHaveFocus());
      expect(window.location.search).toContain("theme=history");
    });

    it("says so on a link that names only the mode", async () => {
      await saveGeneralAt(1);
      window.history.replaceState(null, "", "/?mode=standard");
      await renderSetup();
      expect(screen.getByRole("radio", { name: /Quiz do dia/ })).toBeChecked();
      expect(generalText()).toHaveTextContent(messages.quizGeneralInProgress(2, 10));
    });

    it("keeps the usual description when the saved round is finished", async () => {
      await saveGeneralAt(9, "results");
      window.history.replaceState(null, "", "/");
      await renderSetup();
      expect(generalText()).toHaveTextContent(messages.generalGameDescription);
    });

    it("says nothing when the URL names today's challenge", async () => {
      await saveGeneralAt(3);
      window.history.replaceState(null, "", "/?theme=daily");
      await renderSetup();
      expect(generalText()).toHaveTextContent(messages.generalGameDescription);
    });

    it("looks only at the slot of the mode in use", async () => {
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave(round.session, "catalog", { playMode: "expert", questionIndex: 0 }));
      window.history.replaceState(null, "", "/?mode=standard");
      await renderSetup();
      expect(generalText()).toHaveTextContent(messages.generalGameDescription);
    });
  });

  describe("today's daily quiz already finished", () => {
    const dailyDate = () => dailySeedDate(dailyPtSession as QuizSession)!;
    const dailyCard = () => screen.getByRole("radio", { name: /Quiz do dia/ });

    function finishedDailySave(session: QuizSession, overrides: Partial<Parameters<typeof buildQuizProgressSave>[0]> = {}) {
      const total = session.questions.length;
      return roundSave(session, "published", {
        theme: "daily",
        machineState: "results",
        questionIndex: total - 1,
        score: 300,
        elapsedSeconds: 42,
        history: session.questions.map((question, index) => ({
          question, selectedOptionId: question.answer_option_id, isCorrect: index < 3, cluesUsedCount: 0,
        })),
        ...overrides,
      });
    }

    it("plays the day, goes to the general quiz and back, and shows the day's result without a second round", async () => {
      onDailyDate();
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      startRound();
      await screen.findByRole("heading", { name: dailyPtSession.questions[0]!.prompt });
      await playToResults();
      const stats = loadPlayerStats();
      expect(stats.games.quiz.played).toBe(1);
      const daySave = readSlot(dailySlot);
      const correct = screen.getByText(/^\d+\/10$/).textContent!;
      const starts = () => trackedEvents().filter((name) => name === "game_start").length;
      const startsBefore = starts();

      fireEvent.click(screen.getByRole("button", { name: messages.quizPlayGeneral }));
      await waitForSetup();
      expect(window.location.search).toContain("theme=history");

      fireEvent.click(dailyCard());
      expect(await screen.findByRole("heading", { name: "Fim da partida" })).toBeInTheDocument();
      expect(screen.getByText(messages.quizDailyDoneResult)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Começar partida" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Responder" })).toBeNull();
      expect(await screen.findByText(/^Novo desafio em \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
      // The same result, read from the same save: no second daily round and no second count.
      expect(screen.getByText(correct)).toBeInTheDocument();
      expect(readSlot(dailySlot)).toEqual(daySave);
      expect(loadPlayerStats()).toEqual(stats);
      expect(starts()).toBe(startsBefore);
      expect(isGameMatchRecorded("quiz", `daily-${dailyDate()}`)).toBe(true);
    });

    it("shows the result finished in another mode instead of the day in this one", async () => {
      onDailyDate();
      saveQuizProgress(finishedDailySave(dailyPtSession as QuizSession));
      recordMatchOnce("quiz", `daily-${dailyDate()}`, false, dailyDate());
      const stats = loadPlayerStats();
      window.history.replaceState(null, "", "/?theme=daily&mode=assisted");

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: "Fim da partida" })).toBeInTheDocument();
      expect(screen.getByText(messages.quizDailyDoneResult)).toBeInTheDocument();
      expect(screen.getByText("3/10")).toBeInTheDocument();
      expect(screen.queryByTestId("game-start")).toBeNull();
      expect(window.localStorage.getItem(quizProgressStorageKey({ ...historyConfig, playMode: "assisted", theme: "daily", decades: [] }))).toBeNull();
      expect(loadPlayerStats()).toEqual(stats);
    });

    it("says the day is done when it counts and no result is saved here, and still offers the general quiz", async () => {
      // Counted on another board of the same date, e.g. before a republication.
      onDailyDate();
      recordMatchOnce("quiz", "daily-other-board", true, dailyDate());
      const stats = loadPlayerStats();
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: messages.dailyDoneTitle })).toBeInTheDocument();
      expect(screen.getByText(messages.quizDailyDoneBody)).toBeInTheDocument();
      expect(screen.queryByTestId("game-start")).toBeNull();
      expect(await screen.findByRole("link", { name: /Próximo: Grade/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: messages.quizPlayGeneral }));
      await waitForSetup();
      startRound();
      await waitForQuestion();
      expect(readSlot(dailySlot)).toBeNull();
      expect(loadPlayerStats()).toEqual(stats);
    });

    it("sends game_complete for a general round restored after the day's round, without a game_start", async () => {
      onDailyDate();
      const round = await drawCatalogRound();
      const questions = round.session.questions;
      saveQuizProgress(roundSave(round.session, "catalog", {
        questionIndex: 9,
        history: questions.slice(0, 9).map((question) => ({
          question, selectedOptionId: question.options[0]!.id, isCorrect: false, cluesUsedCount: 0,
        })),
        replayNotice: "ok",
      }));
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      startRound();
      await screen.findByRole("heading", { name: dailyPtSession.questions[0]!.prompt });
      await playToResults();
      await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_start", "game_complete"]));
      gtag.mockClear();

      fireEvent.click(screen.getByRole("button", { name: messages.quizPlayGeneral }));
      const heading = await screen.findByRole("heading", { name: questions[9]!.prompt });
      // The restored round's question takes the focus from the button that unmounted.
      await vi.waitFor(() => expect(heading).toHaveFocus());
      await playToResults(1);

      // The same events as the restore on a new visit: no game_start, one game_complete.
      await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_complete"]));
      expect(gtag.mock.calls[0]![2]).toMatchObject({ daily: "no" });
    });

    it("sends nothing for the day's result picked again and both events for a new general round", async () => {
      onDailyDate();
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      startRound();
      await screen.findByRole("heading", { name: dailyPtSession.questions[0]!.prompt });
      await playToResults();
      await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_start", "game_complete"]));
      gtag.mockClear();

      fireEvent.click(screen.getByRole("button", { name: messages.quizPlayGeneral }));
      await waitForSetup();
      fireEvent.click(dailyCard());
      expect(await screen.findByText(messages.quizDailyDoneResult)).toBeInTheDocument();
      await act(async () => { await Promise.resolve(); });
      expect(trackedEvents()).toEqual([]);

      fireEvent.click(screen.getByRole("button", { name: messages.quizPlayGeneral }));
      await waitForSetup();
      startRound();
      await waitForQuestion();
      await playToResults();
      await vi.waitFor(() => expect(trackedEvents()).toEqual(["game_start", "game_complete"]));
      expect(gtag.mock.calls.map((call) => call[2])).toEqual([
        expect.objectContaining({ daily: "no" }),
        expect.objectContaining({ daily: "no" }),
      ]);
    });

    it("focuses the setup title when the general quiz has no round to restore", async () => {
      onDailyDate();
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");
      await renderSetup();
      startRound();
      await screen.findByRole("heading", { name: dailyPtSession.questions[0]!.prompt });
      await playToResults();

      fireEvent.click(screen.getByRole("button", { name: messages.quizPlayGeneral }));
      await waitForSetup();

      await vi.waitFor(() => expect(screen.getByRole("heading", { name: "Monte sua partida" })).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    });

    it("does not show the day as done while the daily card loads its saved round", async () => {
      // The setup still holds the general session for a moment after the
      // daily card is picked; the day's date must not be read from it.
      onDailyDate();
      recordMatchOnce("quiz", `daily-${dailyDate()}`, true, dailyDate());
      const session = dailyPtSession as QuizSession;
      saveQuizProgress(roundSave(session, "published", {
        theme: "daily",
        questionIndex: 2,
        history: session.questions.slice(0, 2).map((question) => ({
          question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0,
        })),
      }));
      await renderSetup();

      fireEvent.click(dailyCard());
      expect(screen.queryByTestId("daily-done")).toBeNull();
      expect(screen.queryByTestId("game-result")).toBeNull();

      expect(await screen.findByRole("heading", { name: session.questions[2]!.prompt })).toBeInTheDocument();
      expect(screen.queryByTestId("daily-done")).toBeNull();
    });

    it("still restores a daily round left in progress in this slot", async () => {
      onDailyDate();
      recordMatchOnce("quiz", `daily-${dailyDate()}`, true, dailyDate());
      const session = dailyPtSession as QuizSession;
      saveQuizProgress(roundSave(session, "published", {
        theme: "daily",
        questionIndex: 2,
        history: session.questions.slice(0, 2).map((question) => ({
          question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0,
        })),
      }));
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: session.questions[2]!.prompt })).toBeInTheDocument();
    });

    it("shows the saved result in English", async () => {
      onDailyDate();
      const en = getMessages("en");
      const session = dailyVariants["en.standard"].session;
      saveQuizProgress(finishedDailySave(session, { locale: "en" }));
      recordMatchOnce("quiz", `daily-${dailyDate()}`, false, dailyDate());
      window.history.replaceState(null, "", "/en/?theme=daily&mode=standard");

      render(<Quiz locale="en" />);

      expect(await screen.findByRole("heading", { name: en.resultTitle })).toBeInTheDocument();
      expect(screen.getByText(en.quizDailyDoneResult)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en.quizPlayGeneral })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: en.start })).toBeNull();
    });

    it("says the day is done in English when the Portuguese round is the one saved", async () => {
      onDailyDate();
      const en = getMessages("en");
      saveQuizProgress(finishedDailySave(dailyPtSession as QuizSession));
      recordMatchOnce("quiz", `daily-${dailyDate()}`, false, dailyDate());
      window.history.replaceState(null, "", "/en/?theme=daily&mode=standard");

      render(<Quiz locale="en" />);

      expect(await screen.findByRole("heading", { name: en.dailyDoneTitle })).toBeInTheDocument();
      expect(screen.getByText(en.quizDailyDoneBody)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en.quizPlayGeneral })).toBeInTheDocument();
    });
  });

  describe("round in progress in the other language", () => {
    const enConfig = { ...historyConfig, locale: "en" } as const;
    const resumeNotice = () => screen.findByTestId("quiz-other-locale-round");

    function enGeneralAt(questionIndex: number, machineState: "question.ready" | "results" = "question.ready") {
      const session = enSession as QuizSession;
      return roundSave(session, "published", {
        locale: "en",
        machineState,
        questionIndex,
        history: session.questions.slice(0, machineState === "results" ? session.questions.length : questionIndex)
          .map((question) => ({ question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0 })),
      });
    }

    it("tells the Portuguese setup about the English round and links to it there", async () => {
      saveQuizProgress(enGeneralAt(8));
      const enSlot = quizProgressStorageKey({ ...enConfig, decades: [] });
      const saved = window.localStorage.getItem(enSlot);

      await renderSetup();

      expect(await resumeNotice()).toHaveTextContent(messages.quizOtherLocaleRound(false, 9, 10));
      expect(screen.getByText("Você tem um Quiz geral em andamento em inglês, na pergunta 9 de 10. Começar uma partida aqui não apaga a outra.")).toBeInTheDocument();
      const resume = screen.getByRole("link", { name: messages.quizOtherLocaleResume });
      expect(resume).toHaveAttribute("href", "/en/?mode=standard&theme=history");
      expect(resume).toHaveAttribute("hreflang", "en");
      // The action bar shows the short link over the round rules.
      const hint = screen.getByTestId("quiz-other-locale-hint");
      expect(hint).toHaveTextContent("Partida em inglês na pergunta 9 · Continuar em inglês");
      expect(hint).toHaveAttribute("href", "/en/?mode=standard&theme=history");
      expect(hint.closest(".setup-actions")).not.toBeNull();

      // Starting here plays this language's own slot and leaves the English round as it was.
      startRound();
      await waitForQuestion();
      expect(screen.queryByTestId("quiz-other-locale-round")).toBeNull();
      expect(readSlot()).toMatchObject({ locale: "pt-BR", machine_state: "question.ready" });
      expect(window.localStorage.getItem(enSlot)).toBe(saved);
    });

    it("tells the English setup about today's Portuguese daily round", async () => {
      onDailyDate();
      const en = getMessages("en");
      const session = dailyPtSession as QuizSession;
      saveQuizProgress(roundSave(session, "published", {
        theme: "daily",
        questionIndex: 2,
        history: session.questions.slice(0, 2).map((question) => ({ question, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0 })),
      }));
      window.history.replaceState(null, "", "/en/?theme=history");

      render(<Quiz locale="en" />);

      expect(await resumeNotice()).toHaveTextContent(
        "You have a daily quiz in progress in Portuguese, at question 3 of 10. Starting a game here does not delete it.",
      );
      expect(screen.getByRole("link", { name: en.quizOtherLocaleResume })).toHaveAttribute("href", "/pt-br/?mode=standard&theme=daily");
      expect(readSlot(dailySlot)).toMatchObject({ machine_state: "question.ready", question_index: 2 });
    });

    it("puts the notice below the setup card, where it moves nothing on screen", async () => {
      saveQuizProgress(enGeneralAt(8));
      await renderSetup();
      const notice = await resumeNotice();
      expect(screen.getByTestId("game-setup").compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByTestId("game-setup").contains(notice)).toBe(false);
    });

    it("does not flash while this language's own round is being restored", async () => {
      saveQuizProgress(enGeneralAt(8));
      const round = await drawCatalogRound();
      saveQuizProgress(roundSave(round.session, "catalog", { replayNotice: "ok" }));

      render(<Quiz locale="pt-BR" />);
      expect(screen.queryByTestId("quiz-other-locale-round")).toBeNull();

      expect(await screen.findByRole("heading", { name: round.session.questions[0]!.prompt })).toBeInTheDocument();
      expect(screen.queryByTestId("quiz-other-locale-round")).toBeNull();
    });

    it("stays off the finished daily screen, which has no Start button", async () => {
      onDailyDate();
      saveQuizProgress(enGeneralAt(8));
      recordMatchOnce("quiz", "daily-other-board", true, dailySeedDate(dailyPtSession as QuizSession)!);
      window.history.replaceState(null, "", "/?theme=daily&mode=standard");

      render(<Quiz locale="pt-BR" />);

      expect(await screen.findByRole("heading", { name: messages.dailyDoneTitle })).toBeInTheDocument();
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByTestId("quiz-other-locale-round")).toBeNull();
    });

    it("says nothing about a finished round or a daily round from an earlier day", async () => {
      saveQuizProgress(enGeneralAt(9, "results"));
      onDay(dayAfter(dailySeedDate(dailyPtSession as QuizSession)!));
      const session = dailyPtSession as QuizSession;
      saveQuizProgress(roundSave(session, "published", { locale: "en", theme: "daily", questionIndex: 0, history: [] }));
      await renderSetup();
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByTestId("quiz-other-locale-round")).toBeNull();
    });
  });

  describe("storage failures during a round", () => {
    it("shows the notice when a save cannot be written", async () => {
      await renderSetup();
      startRound();
      await waitForQuestion();

      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      fireEvent.click(screen.getAllByRole("radio")[0]!);

      expect(await screen.findByTestId("quiz-storage-notice")).toHaveTextContent(messages.quizStorageUnavailable);
    });
  });

  describe("setup filters and load failures", () => {
    it("selects a decade through the URL and redraws the round", async () => {
      await renderSetup();

      vi.mocked(selectCatalogRound).mockClear();
      fireEvent.click(screen.getByRole("checkbox", { name: messages.decadeLabel(2000) }));
      await waitForSetup();

      expect(new URLSearchParams(window.location.search).getAll("decade")).toEqual(["2000"]);
      expect(new URLSearchParams(window.location.search).get("theme")).toBe("history");
      expect(selectCatalogRound).toHaveBeenCalledWith(expect.objectContaining({ decades: [2000] }));
    });

    it("drops a decade the published sessions cannot honor", async () => {
      world.catalog = "missing";
      window.history.replaceState(null, "", "/?decade=2000");

      await renderSetup();

      expect(new URLSearchParams(window.location.search).getAll("decade")).toEqual([]);
      expect(new URLSearchParams(window.location.search).get("theme")).toBe("history");
    });

    it("clears the filter when the retry follows an unavailable decade", async () => {
      window.history.replaceState(null, "", "/?decade=1990");
      render(<Quiz locale="pt-BR" />);
      expect(await screen.findByText(messages.quizReplayUnavailable)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: messages.retry }));
      await waitForSetup();

      expect(new URLSearchParams(window.location.search).getAll("decade")).toEqual([]);
    });

    it("retries the same draw when no filter caused the shortage", async () => {
      selection.failure = new CatalogSelectionError("unavailable", "too few");
      render(<Quiz locale="pt-BR" />);
      expect(await screen.findByText(messages.quizReplayUnavailable)).toBeInTheDocument();

      selection.failure = null;
      vi.mocked(selectCatalogRound).mockClear();
      fireEvent.click(screen.getByRole("button", { name: messages.retry }));
      await waitForSetup();

      expect(selectCatalogRound).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["an invalid selection", () => new CatalogSelectionError("invalid", "bad pool")],
      ["an unknown error", () => new Error("boom")],
    ])("maps %s on the first load to the invalid state", async (_label, failure) => {
      selection.failure = failure();
      render(<Quiz locale="pt-BR" />);
      expect(await screen.findByText(messages.artifactInvalid)).toBeInTheDocument();
    });
  });
});
