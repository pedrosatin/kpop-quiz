import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDailySetShareText,
  dailySetNumber,
  isDailySetComplete,
  recordDailySetComplete,
  rememberDailySetLine,
  SITE_FIRST_DAILY_DATE,
  stripShareUrl,
} from "./daily-set";
import { DAILY_GAMES, statsGameId } from "./daily-progress";
import {
  ALL_GAME_IDS,
  createInitialPlayerStats,
  exportPlayerStatsJson,
  importPlayerStatsJson,
  loadPlayerStats,
  parsePlayerStatsJson,
  PLAYER_STATS_STORAGE_KEY,
  recordGameFinish,
  resetPlayerStats,
  savePlayerStats,
} from "./player-stats";
import { mapPilotStorageKey } from "../components/MapPilot/map-pilot-save";

const TODAY = "2026-11-10";

function finishAllDaily(date: string): void {
  for (const id of ALL_GAME_IDS) recordGameFinish(id, true, date);
  localStorage.setItem(
    mapPilotStorageKey(date),
    JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }),
  );
}

function rememberAllLines(date: string): void {
  for (const key of DAILY_GAMES) {
    rememberDailySetLine(
      date,
      statsGameId(key),
      `K-pop Quiz · ${key}\nline\nhttps://kpopquiz.online/pt-br/?s=quiz`,
    );
  }
}

describe("daily set", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("numbers the set from the earliest published daily board", () => {
    expect(SITE_FIRST_DAILY_DATE).toBe("2026-09-17");
    expect(dailySetNumber("2026-09-17")).toBe(1);
    expect(dailySetNumber("2026-11-10")).toBe(55);
    expect(dailySetNumber("2026-09-16")).toBeNull();
  });

  it("is complete only when every daily game of the date is finished", () => {
    expect(isDailySetComplete(TODAY)).toBe(false);
    recordGameFinish("quiz", true, TODAY);
    expect(isDailySetComplete(TODAY)).toBe(false);
    finishAllDaily(TODAY);
    expect(isDailySetComplete(TODAY)).toBe(true);
  });

  it("ignores free play when judging the set", () => {
    for (const id of ALL_GAME_IDS) recordGameFinish(id, true);
    expect(isDailySetComplete(TODAY)).toBe(false);
  });

  it("counts a completed set once per date; replay does not duplicate", () => {
    finishAllDaily(TODAY);
    expect(recordDailySetComplete(TODAY)).toBe(true);
    expect(loadPlayerStats().dailySetsCompleted).toBe(1);
    expect(loadPlayerStats().lastDailySetDate).toBe(TODAY);
    expect(recordDailySetComplete(TODAY)).toBe(false);
    expect(loadPlayerStats().dailySetsCompleted).toBe(1);

    const next = "2026-11-11";
    finishAllDaily(next);
    expect(recordDailySetComplete(next)).toBe(true);
    expect(loadPlayerStats().dailySetsCompleted).toBe(2);
  });

  it("does not record a set while a game is still missing", () => {
    for (const id of ALL_GAME_IDS.filter((id) => id !== "crossword")) {
      recordGameFinish(id, true, TODAY);
    }
    localStorage.setItem(
      mapPilotStorageKey(TODAY),
      JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }),
    );
    expect(recordDailySetComplete(TODAY)).toBe(false);
    expect(loadPlayerStats().dailySetsCompleted).toBe(0);
  });

  it("keeps the set incomplete when Strands has no match for the date", () => {
    // Client rule: every DAILY_GAMES entry needs a recorded match. A day whose
    // publication omitted strands.daily.json still leaves the set open until
    // the player can finish Strands (or until a later change teaches the
    // client to skip omitted games from daily-set.json).
    for (const id of ALL_GAME_IDS.filter((id) => id !== "strands")) {
      recordGameFinish(id, true, TODAY);
    }
    localStorage.setItem(
      mapPilotStorageKey(TODAY),
      JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }),
    );
    expect(isDailySetComplete(TODAY)).toBe(false);
    expect(recordDailySetComplete(TODAY)).toBe(false);
    expect(loadPlayerStats().dailySetsCompleted).toBe(0);
  });

  it("includes strands in the day share when every game has a remembered line", () => {
    finishAllDaily(TODAY);
    rememberAllLines(TODAY);
    const text = buildDailySetShareText(TODAY, "pt-BR");
    expect(text).toContain("K-pop Quiz · strands");
  });

  it("strips the trailing share URL and builds the day summary", () => {
    expect(stripShareUrl("body\nhttps://kpopquiz.online/pt-br/?s=quiz")).toBe("body");
    finishAllDaily(TODAY);
    rememberAllLines(TODAY);
    const text = buildDailySetShareText(TODAY, "pt-BR");
    expect(text).toContain("K-pop Quiz #55 · Set do dia");
    expect(text).toContain("K-pop Quiz · quiz");
    expect(text).toContain("K-pop Quiz · crossword");
    expect(text?.endsWith("https://kpopquiz.online/pt-br/?s=quiz")).toBe(true);
    expect(text?.match(/https:\/\//g)?.length).toBe(1);
  });

  it("round-trips the new fields through exportPlayerStatsJson and parsePlayerStatsJson", () => {
    finishAllDaily(TODAY);
    rememberDailySetLine(TODAY, "quiz", "Quiz body\nhttps://example.test/");
    recordDailySetComplete(TODAY);
    const exported = exportPlayerStatsJson();
    resetPlayerStats();
    expect(loadPlayerStats().dailySetsCompleted).toBe(0);
    expect(parsePlayerStatsJson(exported)).toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(importPlayerStatsJson(exported)).toEqual({ success: true });
    const restored = loadPlayerStats();
    expect(restored.dailySetsCompleted).toBe(1);
    expect(restored.lastDailySetDate).toBe(TODAY);
    expect(restored.dailySetLines?.[TODAY]?.quiz).toBe("Quiz body");
  });

  it("builds the day share when the caller confirms the set before the last flush", () => {
    finishAllDaily(TODAY);
    // Drop crossword from stats so isDailySetComplete is false, as on the
    // last game before useRecordDailyMatch runs.
    const stats = loadPlayerStats();
    delete stats.games.crossword.lastPlayedDate;
    savePlayerStats(stats);
    rememberAllLines(TODAY);
    expect(isDailySetComplete(TODAY)).toBe(false);
    expect(buildDailySetShareText(TODAY, "pt-BR")).toBeNull();
    const text = buildDailySetShareText(TODAY, "pt-BR", true);
    expect(text).toContain("K-pop Quiz #55 · Set do dia");
    expect(text).toContain("K-pop Quiz · crossword");
  });

  it("records the board date even after Sao Paulo midnight on the clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:01 on 2026-11-11 in America/Sao_Paulo.
    vi.setSystemTime(new Date("2026-11-11T03:01:00Z"));
    finishAllDaily("2026-11-10");
    expect(recordDailySetComplete("2026-11-10")).toBe(true);
    expect(loadPlayerStats().lastDailySetDate).toBe("2026-11-10");
    expect(isDailySetComplete("2026-11-11")).toBe(false);
  });

  it("tolerates corrupted daily set fields in local storage", () => {
    const base = createInitialPlayerStats();
    for (const bad of ["x", -1, 1.5] as const) {
      localStorage.setItem(
        PLAYER_STATS_STORAGE_KEY,
        JSON.stringify({ ...base, dailySetsCompleted: bad }),
      );
      expect(loadPlayerStats().dailySetsCompleted).toBe(0);
    }
    localStorage.setItem(
      PLAYER_STATS_STORAGE_KEY,
      JSON.stringify({
        ...base,
        dailySetsCompleted: 2,
        lastDailySetDate: "not-a-date",
        dailySetLines: ["array"],
      }),
    );
    const cleaned = loadPlayerStats();
    expect(cleaned.dailySetsCompleted).toBe(2);
    expect(cleaned).not.toHaveProperty("lastDailySetDate");
    expect(cleaned).not.toHaveProperty("dailySetLines");
    localStorage.setItem(
      PLAYER_STATS_STORAGE_KEY,
      JSON.stringify({
        ...base,
        dailySetLines: {
          "not-a-date": { quiz: "bad key" },
          "2026-11": { quiz: "short key" },
          [TODAY]: { quiz: "ok" },
        },
      }),
    );
    expect(loadPlayerStats().dailySetLines).toEqual({ [TODAY]: { quiz: "ok" } });
  });
});
