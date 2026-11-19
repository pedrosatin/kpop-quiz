import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import groupSession from "../../../public/data/group-pages/stray-kids/session.pt-BR.json";
import { isDailyMatchRecorded, isGameMatchRecorded, loadPlayerStats } from "../../lib/player-stats";
import type { QuizSession } from "../../lib/quiz-types";
import { dailyReferenceDate } from "../../data/daily-artifact";
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

  it("records free play and leaves the daily quiz slot and daily-<date> marker alone", async () => {
    localStorage.setItem(dailySlot, JSON.stringify({ marker: "daily-in-progress" }));
    localStorage.setItem(historySlot, JSON.stringify({ marker: "history-in-progress" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("heading", { name: "Fim da partida" });

    await waitFor(() => {
      expect(isGameMatchRecorded("quiz", `session-${session.session_id}`)).toBe(true);
    });

    const today = dailyReferenceDate();
    expect(isDailyMatchRecorded("quiz", today)).toBe(false);
    expect(loadPlayerStats().games.quiz?.played).toBe(1);
    expect(loadPlayerStats().games.quiz?.lastPlayedDate).toBeUndefined();

    expect(localStorage.getItem(dailySlot)).toBe(JSON.stringify({ marker: "daily-in-progress" }));
    expect(localStorage.getItem(historySlot)).toBe(JSON.stringify({ marker: "history-in-progress" }));
    expect(window.location.search).toBe("");
    expect(screen.getByRole("button", { name: "Jogar novamente" })).toBeInTheDocument();
    expect(screen.queryByTestId("quiz-play-general")).toBeNull();
  });
});
