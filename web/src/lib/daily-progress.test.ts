import { afterEach, describe, expect, it } from "vitest";
import { completedDailyGames, DAILY_GAMES, dailyGamePath, formatCountdown, nextDailyGame, statsGameId } from "./daily-progress";
import { ALL_GAME_IDS, recordGameFinish } from "./player-stats";
import { mapPilotStorageKey } from "../components/MapPilot/map-pilot-save";

const TODAY = "2026-11-10";

describe("daily progress", () => {
  afterEach(() => localStorage.clear());

  it("lists the games in tab order", () => {
    expect(DAILY_GAMES).toEqual([
      "quiz", "grid", "connections", "nameGuess", "wordSearch", "mapPilot", "timeline", "code", "crossword",
    ]);
  });

  it("counts a daily match of today, won or lost, and skips free play and other days", () => {
    recordGameFinish("connections", false, TODAY);
    recordGameFinish("name-guess", true, "2026-11-09");
    recordGameFinish("grid", true);
    expect([...completedDailyGames(TODAY)]).toEqual(["connections"]);
  });

  it("counts the map round of today once its result shows", () => {
    const save = (index: number) =>
      localStorage.setItem(mapPilotStorageKey(TODAY), JSON.stringify({ events: ["a", "b"], answers: ["x"], index }));
    save(1);
    expect(completedDailyGames(TODAY).has("mapPilot")).toBe(false);
    save(2);
    expect(completedDailyGames(TODAY).has("mapPilot")).toBe(true);
    expect(completedDailyGames("2026-11-11").has("mapPilot")).toBe(false);
  });

  it("picks the first unfinished game in tab order other than the current one", () => {
    expect(nextDailyGame("quiz", new Set())).toBe("grid");
    expect(nextDailyGame("connections", new Set())).toBe("quiz");
    expect(nextDailyGame("connections", new Set(["quiz", "grid"]))).toBe("nameGuess");
    expect(nextDailyGame("crossword", new Set(DAILY_GAMES.filter((key) => key !== "crossword")))).toBeNull();
  });

  it("links the quiz to its daily theme", () => {
    expect(dailyGamePath("quiz", "pt-BR")).toBe("/pt-br/?theme=daily");
    expect(dailyGamePath("nameGuess", "en")).toBe("/en/guess/");
  });

  it("formats the countdown as HH:MM:SS", () => {
    expect(formatCountdown(86400)).toBe("24:00:00");
    expect(formatCountdown(4 * 3600 + 5 * 60 + 9)).toBe("04:05:09");
    expect(formatCountdown(0)).toBe("00:00:00");
  });
});

describe("statsGameId", () => {
  it("maps every game page to its own stats entry", () => {
    expect(statsGameId("mapPilot")).toBe("map");
    expect(statsGameId("nameGuess")).toBe("name-guess");
    expect(DAILY_GAMES.map(statsGameId).sort()).toEqual([...ALL_GAME_IDS].sort());
  });
});
