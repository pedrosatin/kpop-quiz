import { describe, expect, it } from "vitest";
import { dailyReferenceDate } from "../data/daily-artifact";
import { getMessages } from "../i18n/catalog";
import { dailyChallengeNumber, dailyShareHeader, FIRST_DAILY_DATE } from "./daily-challenge";
import type { SeoRouteKey } from "../i18n/catalog";
import { shareCampaignConfig, SEO_ROUTES, seoShareUrl, seoShareCampaign } from "./seo-routes";

describe("published daily challenge numbers", () => {
  it("pins the first reference dates from the artifact history", () => {
    expect(FIRST_DAILY_DATE).toEqual({ quiz: "2026-09-18", grid: "2026-09-17", connections: "2026-09-17", nameGuess: "2026-09-18", wordSearch: "2026-09-18", timeline: "2026-09-19", mapPilot: "2026-09-25", code: "2026-10-19", crossword: "2026-11-03" });
  });
  for (const game of Object.keys(FIRST_DAILY_DATE) as SeoRouteKey[]) {
    it(`${game}: first day, arbitrary day and replay use the artifact date`, () => {
      const first = FIRST_DAILY_DATE[game];
      expect(dailyChallengeNumber(game, first)).toBe(1);
      const later = new Date(Date.parse(first) + 42 * 86400000).toISOString().slice(0, 10);
      expect(dailyChallengeNumber(game, later)).toBe(43);
      expect(dailyShareHeader(game, "Game", first)).toBe("K-pop Quiz #1 · Game");
      expect(dailyShareHeader(game, "Game", later)).toBe("K-pop Quiz #43 · Game");
      expect(dailyShareHeader(game, "Game")).toBe("K-pop Quiz · Game");
    });
  }
  it("turns at midnight in Brasilia, rather than UTC", () => {
    expect(dailyChallengeNumber("quiz", dailyReferenceDate(new Date("2026-09-19T02:59:59Z")))).toBe(1);
    expect(dailyChallengeNumber("quiz", dailyReferenceDate(new Date("2026-09-19T03:00:00Z")))).toBe(2);
  });
  it("uses the same number in PT and EN", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const m = getMessages(locale);
      for (const text of [m.shareDailyHeader("2026-11-18", 1, 2), m.gridShareHeader("2026-11-18", 1, 2), m.connectionsShareHeader("2026-11-18"), m.wordSearchShareHeader("2026-11-18", 1, 2, "00:10"), m.mapShareHeader("2026-11-18"), m.nameGuessShareHeader("2026-11-18", "1/6"), m.codeShareHeader("2026-11-18")]) {
        expect(text).toMatch(/^K-pop Quiz #\d+ · /);
      }
      expect(m.shareDailyHeader("2026-11-18", 1, 2)).toContain("#62");
    }
  });
  it("rejects dates before publication and invalid dates", () => {
    for (const date of ["2026-02-30", "2026-01-01", "invalid", "2026-9-18"]) expect(dailyChallengeNumber("quiz", date)).toBeNull();
  });
});

describe("short share campaign", () => {
  it("maps all nine games in both languages to standard campaign fields", () => {
    for (const route of SEO_ROUTES) expect(shareCampaignConfig(new URL(seoShareUrl(route.key, route.locale)).search)).toEqual({ campaign_source: "share", campaign_medium: "social", campaign_name: seoShareCampaign(route.key) });
  });
  it("ignores unknown values and preserves legacy UTM attribution", () => {
    for (const search of ["", "?s=unknown", "?s=", "?s=quiz&utm_source=other", "?s=quiz&utm_medium=email", "?s=quiz&utm_campaign=legacy"]) expect(shareCampaignConfig(search)).toEqual({});
  });
});
