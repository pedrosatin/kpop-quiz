import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_SET_VERSION,
  isDailySetRecord,
  loadDailySetRequirement,
  REQUIRE_ALL_DAILY_GAMES,
} from "./daily-set-loader";

const TODAY = "2026-11-21";
const TOMORROW = "2026-11-22";
const YESTERDAY = "2026-11-20";

function record(referenceDate: string, omitted: Record<string, string> = {}) {
  return {
    schema_version: DAILY_SET_VERSION,
    reference_date: referenceDate,
    omitted,
  };
}

function routeFetch(routes: Record<string, unknown | number>) {
  return vi.fn(async (url: string) => {
    if (!(url in routes)) return new Response(null, { status: 404 });
    const body = routes[url];
    if (typeof body === "number") return new Response(null, { status: body });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("isDailySetRecord", () => {
  it("accepts the published empty-omission shape", () => {
    expect(isDailySetRecord(record(TODAY))).toBe(true);
  });

  it("rejects extra fields, unknown games, and another date shape", () => {
    expect(isDailySetRecord({ ...record(TODAY), extra: true })).toBe(false);
    expect(isDailySetRecord(record(TODAY, { "not-a-game": "x" }))).toBe(false);
    expect(isDailySetRecord(record(TODAY, { strands: "" }))).toBe(false);
    expect(isDailySetRecord(record(TODAY, { strands: "line\nbreak" }))).toBe(false);
    expect(
      isDailySetRecord({
        schema_version: "other",
        reference_date: TODAY,
        omitted: {},
      }),
    ).toBe(false);
  });
});

describe("loadDailySetRequirement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns omitted SeoRouteKeys for today's main record", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/daily-set.json": record(TODAY, { strands: "generation failed (ValueError)" }),
    }));
    const result = await loadDailySetRequirement("/", TODAY);
    expect([...result.omitted]).toEqual(["strands"]);
  });

  it("maps code-groups and name-guess to the web route keys", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/daily-set.json": record(TODAY, {
        "code-groups": "generation failed (ValueError)",
        "name-guess": "generation failed (OSError)",
      }),
    }));
    const result = await loadDailySetRequirement("/", TODAY);
    expect([...result.omitted].sort()).toEqual(["code", "nameGuess"]);
  });

  it("requires every game when the record is absent", async () => {
    vi.stubGlobal("fetch", routeFetch({}));
    await expect(loadDailySetRequirement("/", TODAY)).resolves.toEqual(REQUIRE_ALL_DAILY_GAMES);
  });

  it("requires every game when the record is invalid JSON or shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })),
    );
    await expect(loadDailySetRequirement("/", TODAY)).resolves.toEqual(REQUIRE_ALL_DAILY_GAMES);

    vi.stubGlobal("fetch", routeFetch({
      "/data/daily-set.json": { ...record(TODAY), omitted: { strands: "ok" }, extra: 1 },
    }));
    await expect(loadDailySetRequirement("/", TODAY)).resolves.toEqual(REQUIRE_ALL_DAILY_GAMES);
  });

  it("requires every game when the main record is for another day and next is absent", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/daily-set.json": record(YESTERDAY, { strands: "generation failed (ValueError)" }),
    }));
    await expect(loadDailySetRequirement("/", TODAY)).resolves.toEqual(REQUIRE_ALL_DAILY_GAMES);
  });

  it("uses next/ when its reference_date is today and main is still yesterday", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/daily-set.json": record(YESTERDAY),
      "/data/next/daily-set.json": record(TODAY, { strands: "generation failed (ValueError)" }),
    }));
    const result = await loadDailySetRequirement("/", TODAY);
    expect([...result.omitted]).toEqual(["strands"]);
  });

  it("uses next/ when main is missing and next is today", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/next/daily-set.json": record(TODAY, { crossword: "generation failed (ValueError)" }),
    }));
    const result = await loadDailySetRequirement("/", TODAY);
    expect([...result.omitted]).toEqual(["crossword"]);
  });

  it("ignores next/ while its date is still tomorrow", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/daily-set.json": record(TODAY),
      "/data/next/daily-set.json": record(TOMORROW, { strands: "generation failed (ValueError)" }),
    }));
    const result = await loadDailySetRequirement("/", TODAY);
    expect([...result.omitted]).toEqual([]);
  });

  it("requires every game after Sao Paulo midnight when only tomorrow's next/ exists", async () => {
    vi.stubGlobal("fetch", routeFetch({
      "/data/next/daily-set.json": record(TOMORROW, { strands: "generation failed (ValueError)" }),
    }));
    await expect(loadDailySetRequirement("/", TODAY)).resolves.toEqual(REQUIRE_ALL_DAILY_GAMES);
  });

  it("requires every game when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network");
    }));
    await expect(loadDailySetRequirement("/", TODAY)).resolves.toEqual(REQUIRE_ALL_DAILY_GAMES);
  });
});
