import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_GAME_IDS,
  calculateNewStreak,
  createInitialPlayerStats,
  getDaysDifference,
  getMatchRecordKey,
  isGameMatchRecorded,
  loadPlayerStats,
  markGameMatchRecorded,
  PLAYER_STATS_STORAGE_KEY,
  recordGameFinish,
  savePlayerStats,
} from "./player-stats";

describe("player-stats module", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("date and difference calculation", () => {
    it("calculates difference in days between consecutive dates", () => {
      expect(getDaysDifference("2026-09-17", "2026-09-18")).toBe(1);
      expect(getDaysDifference("2026-09-18", "2026-09-18")).toBe(0);
      expect(getDaysDifference("2026-09-15", "2026-09-18")).toBe(3);
      expect(getDaysDifference("2026-08-31", "2026-09-01")).toBe(1);
    });
  });

  describe("loadPlayerStats and savePlayerStats", () => {
    it("returns clean initial stats when localStorage is empty", () => {
      const stats = loadPlayerStats();
      expect(stats.version).toBe(1);
      expect(stats.overall).toEqual({ played: 0, won: 0, currentStreak: 0, maxStreak: 0 });
      for (const gameId of ALL_GAME_IDS) {
        expect(stats.games[gameId].played).toBe(0);
        expect(stats.games[gameId].won).toBe(0);
        expect(stats.games[gameId].currentStreak).toBe(0);
        expect(stats.games[gameId].maxStreak).toBe(0);
      }
      expect(stats.games["name-guess"].guessDistribution).toEqual({
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
      });
    });

    it("saves and loads stats correctly", () => {
      const stats = createInitialPlayerStats();
      stats.overall.played = 5;
      stats.overall.won = 4;
      stats.overall.currentStreak = 2;
      stats.overall.maxStreak = 3;
      savePlayerStats(stats);

      const loaded = loadPlayerStats();
      expect(loaded.overall.played).toBe(5);
      expect(loaded.overall.won).toBe(4);
      expect(loaded.overall.currentStreak).toBe(2);
      expect(loaded.overall.maxStreak).toBe(3);
    });

    it("handles corrupted or malformed data in localStorage safely", () => {
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, "invalid-json{{");
      const stats = loadPlayerStats();
      expect(stats.version).toBe(1);
      expect(stats.overall.played).toBe(0);
    });

    it("handles incompatible version gracefully", () => {
      localStorage.setItem(PLAYER_STATS_STORAGE_KEY, JSON.stringify({ version: 99 }));
      const stats = loadPlayerStats();
      expect(stats.version).toBe(1);
      expect(stats.overall.played).toBe(0);
    });
  });

  describe("calculateNewStreak pure helper", () => {
    it("starts streak at 1 on win without previous date", () => {
      expect(calculateNewStreak(0, undefined, "2026-09-18", true)).toBe(1);
    });

    it("starts streak at 0 on loss without previous date", () => {
      expect(calculateNewStreak(0, undefined, "2026-09-18", false)).toBe(0);
    });

    it("increments streak on consecutive day win", () => {
      expect(calculateNewStreak(1, "2026-09-17", "2026-09-18", true)).toBe(2);
      expect(calculateNewStreak(5, "2026-09-17", "2026-09-18", true)).toBe(6);
    });

    it("resets streak to 0 on consecutive day loss", () => {
      expect(calculateNewStreak(5, "2026-09-17", "2026-09-18", false)).toBe(0);
    });

    it("maintains current streak on same day play", () => {
      expect(calculateNewStreak(3, "2026-09-18", "2026-09-18", true)).toBe(3);
      expect(calculateNewStreak(3, "2026-09-18", "2026-09-18", false)).toBe(3);
    });

    it("resets streak to 1 on jump of days with win", () => {
      expect(calculateNewStreak(4, "2026-09-15", "2026-09-18", true)).toBe(1);
    });

    it("resets streak to 0 on jump of days with loss", () => {
      expect(calculateNewStreak(4, "2026-09-15", "2026-09-18", false)).toBe(0);
    });
  });

  describe("recordGameFinish scenarios", () => {
    it("handles consecutive days of victories", () => {
      let stats = recordGameFinish("quiz", true, "2026-09-16");
      expect(stats.games.quiz.currentStreak).toBe(1);
      expect(stats.games.quiz.maxStreak).toBe(1);
      expect(stats.overall.currentStreak).toBe(1);
      expect(stats.overall.maxStreak).toBe(1);

      stats = recordGameFinish("quiz", true, "2026-09-17");
      expect(stats.games.quiz.currentStreak).toBe(2);
      expect(stats.games.quiz.maxStreak).toBe(2);
      expect(stats.overall.currentStreak).toBe(2);
      expect(stats.overall.maxStreak).toBe(2);

      stats = recordGameFinish("quiz", true, "2026-09-18");
      expect(stats.games.quiz.currentStreak).toBe(3);
      expect(stats.games.quiz.maxStreak).toBe(3);
      expect(stats.overall.currentStreak).toBe(3);
      expect(stats.overall.maxStreak).toBe(3);
    });

    it("resets streak when consecutive day is a defeat", () => {
      let stats = recordGameFinish("grid", true, "2026-09-16");
      expect(stats.games.grid.currentStreak).toBe(1);

      stats = recordGameFinish("grid", true, "2026-09-17");
      expect(stats.games.grid.currentStreak).toBe(2);
      expect(stats.games.grid.maxStreak).toBe(2);

      stats = recordGameFinish("grid", false, "2026-09-18");
      expect(stats.games.grid.currentStreak).toBe(0);
      expect(stats.games.grid.maxStreak).toBe(2); // Max streak is preserved
      expect(stats.overall.currentStreak).toBe(0);
      expect(stats.overall.maxStreak).toBe(2);
    });

    it("maintains daily streak when multiple games are played on the same day", () => {
      let stats = recordGameFinish("connections", true, "2026-09-18");
      expect(stats.games.connections.currentStreak).toBe(1);
      expect(stats.games.connections.played).toBe(1);
      expect(stats.games.connections.won).toBe(1);
      expect(stats.overall.currentStreak).toBe(1);
      expect(stats.overall.played).toBe(1);

      // Second game on the same day (win)
      stats = recordGameFinish("connections", true, "2026-09-18");
      expect(stats.games.connections.currentStreak).toBe(1); // Streak does not duplicate on same day
      expect(stats.games.connections.played).toBe(2);
      expect(stats.games.connections.won).toBe(2);
      expect(stats.overall.currentStreak).toBe(1);
      expect(stats.overall.played).toBe(2);

      // Third game on the same day (loss)
      stats = recordGameFinish("connections", false, "2026-09-18");
      expect(stats.games.connections.currentStreak).toBe(1); // Day streak maintained
      expect(stats.games.connections.played).toBe(3);
      expect(stats.games.connections.won).toBe(2);
      expect(stats.overall.played).toBe(3);
      expect(stats.overall.won).toBe(2);
    });

    it("handles day jumps (salto de dias) by resetting streak to 1 on win", () => {
      let stats = recordGameFinish("word-search", true, "2026-09-10");
      expect(stats.games["word-search"].currentStreak).toBe(1);

      // Played 4 days later
      stats = recordGameFinish("word-search", true, "2026-09-14");
      expect(stats.games["word-search"].currentStreak).toBe(1);
      expect(stats.games["word-search"].maxStreak).toBe(1);
      expect(stats.games["word-search"].played).toBe(2);
      expect(stats.games["word-search"].won).toBe(2);
    });

    it("handles day jumps with defeat by resetting streak to 0", () => {
      let stats = recordGameFinish("word-search", true, "2026-09-10");
      expect(stats.games["word-search"].currentStreak).toBe(1);

      // Played 4 days later and lost
      stats = recordGameFinish("word-search", false, "2026-09-14");
      expect(stats.games["word-search"].currentStreak).toBe(0);
      expect(stats.games["word-search"].maxStreak).toBe(1);
      expect(stats.games["word-search"].played).toBe(2);
      expect(stats.games["word-search"].won).toBe(1);
    });

    it("tracks Name Guess distribution accurately", () => {
      // Won on 3rd attempt
      let stats = recordGameFinish("name-guess", true, "2026-09-15", 3);
      expect(stats.games["name-guess"].guessDistribution?.[3]).toBe(1);
      expect(stats.games["name-guess"].guessDistribution?.[1]).toBe(0);

      // Won on 1st attempt
      stats = recordGameFinish("name-guess", true, "2026-09-16", 1);
      expect(stats.games["name-guess"].guessDistribution?.[1]).toBe(1);
      expect(stats.games["name-guess"].guessDistribution?.[3]).toBe(1);

      // Won on 3rd attempt again
      stats = recordGameFinish("name-guess", true, "2026-09-17", 3);
      expect(stats.games["name-guess"].guessDistribution?.[3]).toBe(2);

      // Defeat should not increment distribution
      stats = recordGameFinish("name-guess", false, "2026-09-18", 6);
      expect(stats.games["name-guess"].guessDistribution?.[6]).toBe(0);
      expect(stats.games["name-guess"].played).toBe(4);
      expect(stats.games["name-guess"].won).toBe(3);
    });

    it("tracks individual games separately while aggregating in overall", () => {
      // Day 1: Quiz won
      let stats = recordGameFinish("quiz", true, "2026-09-17");
      expect(stats.games.quiz.currentStreak).toBe(1);
      expect(stats.games.grid.currentStreak).toBe(0);
      expect(stats.overall.currentStreak).toBe(1);

      // Day 1: Grid won
      stats = recordGameFinish("grid", true, "2026-09-17");
      expect(stats.games.quiz.currentStreak).toBe(1);
      expect(stats.games.grid.currentStreak).toBe(1);
      expect(stats.overall.currentStreak).toBe(1); // Same day overall maintains 1
      expect(stats.overall.played).toBe(2);
      expect(stats.overall.won).toBe(2);

      // Day 2: Quiz won
      stats = recordGameFinish("quiz", true, "2026-09-18");
      expect(stats.games.quiz.currentStreak).toBe(2);
      expect(stats.overall.currentStreak).toBe(2); // Consecutive day increments overall
    });
  });

  describe("match deduplication helpers", () => {
    it("reports match as unrecorded initially and recorded once marked", () => {
      const matchId = "daily-2026-09-18";
      expect(isGameMatchRecorded("quiz", matchId)).toBe(false);

      markGameMatchRecorded("quiz", matchId);
      expect(isGameMatchRecorded("quiz", matchId)).toBe(true);

      // Different game with same matchId is not marked
      expect(isGameMatchRecorded("grid", matchId)).toBe(false);
    });

    it("generates predictable key", () => {
      expect(getMatchRecordKey("quiz", "123")).toBe("kpop-match-recorded-quiz-123");
    });
  });
});
