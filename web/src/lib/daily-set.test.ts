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
import { ALL_GAME_IDS, loadPlayerStats, recordGameFinish, resetPlayerStats } from "./player-stats";
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

  it("keeps export/import of the new fields", () => {
    finishAllDaily(TODAY);
    rememberDailySetLine(TODAY, "quiz", "Quiz body\nhttps://example.test/");
    recordDailySetComplete(TODAY);
    const before = loadPlayerStats();
    expect(before.dailySetsCompleted).toBe(1);
    expect(before.dailySetLines?.[TODAY]?.quiz).toBe("Quiz body");
    resetPlayerStats();
    expect(loadPlayerStats().dailySetsCompleted).toBe(0);
  });

  it("turns the day in America/Sao_Paulo like the other daily helpers", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 2026-11-10 23:30 in Sao Paulo is still the 10th; 02:30 UTC next day is the 11th SP.
    vi.setSystemTime(new Date("2026-11-11T02:30:00Z"));
    finishAllDaily("2026-11-10");
    expect(isDailySetComplete("2026-11-10")).toBe(true);
    expect(isDailySetComplete("2026-11-11")).toBe(false);
  });
});
