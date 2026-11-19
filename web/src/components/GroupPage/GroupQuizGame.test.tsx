import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import groupSession from "../../../public/data/group-pages/stray-kids/session.pt-BR.json";
import { isDailyMatchRecorded, isGameMatchRecorded, loadPlayerStats } from "../../lib/player-stats";
import type { QuizSession } from "../../lib/quiz-types";
import { dailyReferenceDate } from "../../data/daily-artifact";
import { generateShareText } from "../Results/ShareResult";
import { getMessages } from "../../i18n/catalog";
import { quizProgressStorageKey } from "../Quiz/storage";
import { GroupQuizGame } from "./GroupQuizGame";

const session = groupSession as unknown as QuizSession;

vi.mock("../../data/group-page-loader", () => ({
  GroupPageArtifactError: class extends Error {
    kind: "missing" | "invalid";
    constructor(kind: "missing" | "invalid") {
      super(kind);
      this.kind = kind;
    }
  },
  loadGroupQuizSession: vi.fn(async () => structuredClone(session)),
}));

const dailySlot = quizProgressStorageKey({
  locale: "pt-BR",
  playMode: "standard",
  theme: "daily",
  decades: [],
});
const historySlot = quizProgressStorageKey({
  locale: "pt-BR",
  playMode: "standard",
  theme: "history",
  decades: [],
});

describe("GroupQuizGame isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/pt-br/stray-kids/");
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the group start card while the session loads (never the home setup)", async () => {
    render(
      <GroupQuizGame
        slug="stray-kids"
        locale="pt-BR"
        startLabel="Começar o quiz"
        startBlurb="Quiz do grupo"
      />,
    );

    expect(screen.getByTestId("group-quiz-start")).toBeInTheDocument();
    expect(screen.queryByTestId("game-setup")).toBeNull();
    await screen.findByTestId("group-quiz-begin");
    expect(screen.queryByTestId("game-setup")).toBeNull();
  });

  it("leaves player stats, daily markers, progress slots and preferences alone", async () => {
    localStorage.setItem(dailySlot, JSON.stringify({ marker: "daily-in-progress" }));
    localStorage.setItem(historySlot, JSON.stringify({ marker: "history-in-progress" }));
    localStorage.setItem("kpop-quiz-play-mode", "expert");
    localStorage.setItem("kpop-quiz-timer-enabled", "true");

    render(
      <GroupQuizGame
        slug="stray-kids"
        locale="pt-BR"
        startLabel="Começar o quiz"
        startBlurb="Quiz do grupo"
      />,
    );

    await screen.findByTestId("group-quiz-begin");
    fireEvent.click(screen.getByTestId("group-quiz-begin"));
    await screen.findByRole("button", { name: "Desistir" });

    expect(window.location.search).toBe("");
    expect(localStorage.getItem(dailySlot)).toBe(JSON.stringify({ marker: "daily-in-progress" }));
    expect(localStorage.getItem(historySlot)).toBe(JSON.stringify({ marker: "history-in-progress" }));
    expect(localStorage.getItem("kpop-quiz-play-mode")).toBe("expert");
    expect(localStorage.getItem("kpop-quiz-timer-enabled")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("heading", { name: "Fim da partida" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Jogar novamente" })).toBeInTheDocument();
    });

    expect(isGameMatchRecorded("quiz", `session-${session.session_id}`)).toBe(false);
    const today = dailyReferenceDate();
    expect(isDailyMatchRecorded("quiz", today)).toBe(false);
    expect(loadPlayerStats().games.quiz?.played ?? 0).toBe(0);
    expect(loadPlayerStats().overall.played).toBe(0);

    expect(localStorage.getItem("kpop-quiz-play-mode")).toBe("expert");
    expect(localStorage.getItem("kpop-quiz-timer-enabled")).toBe("true");
    expect(localStorage.getItem(dailySlot)).toBe(JSON.stringify({ marker: "daily-in-progress" }));
    expect(localStorage.getItem(historySlot)).toBe(JSON.stringify({ marker: "history-in-progress" }));
    expect(window.location.search).toBe("");
    expect(screen.queryByTestId("quiz-play-general")).toBeNull();
    expect(screen.queryByTestId("quiz-replay-notice")).toBeNull();
  });

  it("replays the same session without the catalog-missing notice", async () => {
    render(
      <GroupQuizGame
        slug="stray-kids"
        locale="pt-BR"
        startLabel="Começar o quiz"
        startBlurb="Quiz do grupo"
      />,
    );

    await screen.findByTestId("group-quiz-begin");
    fireEvent.click(screen.getByTestId("group-quiz-begin"));
    await screen.findByRole("button", { name: "Desistir" });
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("button", { name: "Jogar novamente" });

    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
    await screen.findByRole("button", { name: "Desistir" });
    expect(screen.getByTestId("game-board")).toBeInTheDocument();

    // The notice only renders on the result screen, so finish the replayed
    // round before checking that it stays away.
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("button", { name: "Jogar novamente" });
    expect(screen.queryByTestId("quiz-replay-notice")).toBeNull();
  });

  it("shares the group page URL, not the home quiz", () => {
    const text = generateShareText({
      correctCount: 7,
      totalQuestions: 10,
      results: [true, true, true, true, true, true, true, false, false, false],
      playMode: "standard",
      cluesUsedCount: 0,
      elapsedSeconds: 90,
      messages: getMessages("pt-BR"),
      locale: "pt-BR",
      shareUrl: "https://kpopquiz.online/pt-br/stray-kids/",
    });
    expect(text).toContain("https://kpopquiz.online/pt-br/stray-kids/");
    expect(text).not.toContain("https://kpopquiz.online/pt-br/?s=quiz");
  });
});
