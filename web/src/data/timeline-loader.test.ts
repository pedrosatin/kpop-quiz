import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineArtifactError, loadTimelinePuzzle } from "./timeline-loader";
import { isTimelinePuzzle } from "../lib/quiz-types";
import validTimeline from "../tests/fixtures/timeline.daily.json";

describe("published timeline puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant timeline puzzle payload", () => {
    expect(isTimelinePuzzle(validTimeline)).toBe(true);
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(validTimeline)));
    vi.stubGlobal("fetch", fetch);

    const result = await loadTimelinePuzzle("pt-BR", "/base", validTimeline.reference_date);
    expect(result.schema_version).toBe("kpop-timeline-puzzle-v1");
    expect(result.events).toHaveLength(5);
    expect(fetch).toHaveBeenCalledWith(`/base/data/timeline.daily.json?d=${validTimeline.reference_date}`);
  });

  it("keeps a reused puzzle from an earlier day", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(validTimeline), { headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadTimelinePuzzle("pt-BR", "/", "2099-01-01");
    expect(result.reference_date).toBe(validTimeline.reference_date);
    expect(fetch).toHaveBeenCalledWith("/data/timeline.daily.json?d=2099-01-01");
  });

  it("treats the host's HTML fallback as a missing artifact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<!DOCTYPE html><html></html>", { headers: { "content-type": "text/html; charset=utf-8" } })
    ));
    await expect(loadTimelinePuzzle("pt-BR")).rejects.toEqual(new TimelineArtifactError("missing"));
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadTimelinePuzzle("pt-BR")).rejects.toEqual(new TimelineArtifactError("missing"));
  });

  it("falls back to data/next/ when root artifact is 404 and next reference date matches today", async () => {
    const today = validTimeline.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validTimeline), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadTimelinePuzzle("pt-BR", "/base", today);
    expect(result.schema_version).toBe("kpop-timeline-puzzle-v1");
    expect(result.reference_date).toBe(today);
    expect(fetch).toHaveBeenCalledWith(`/base/data/timeline.daily.json?d=${today}`);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/timeline.daily.json");
  });

  it("falls back to data/next/ when root artifact returns HTML fallback", async () => {
    const today = validTimeline.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validTimeline), { headers: { "content-type": "application/json" } })
        : new Response("<!DOCTYPE html><html></html>", { headers: { "content-type": "text/html; charset=utf-8" } })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadTimelinePuzzle("pt-BR", "/base", today);
    expect(result.reference_date).toBe(today);
  });

  it("throws missing when both root artifact and next/ return 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    await expect(loadTimelinePuzzle("pt-BR", "/base", "2026-03-30")).rejects.toEqual(
      new TimelineArtifactError("missing")
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/timeline.daily.json?d=2026-03-30");
    expect(fetch).toHaveBeenCalledWith("/base/data/next/timeline.daily.json");
  });

  it("does not prematurely serve future puzzle from next/ when root artifact is 404", async () => {
    const futureTimeline = structuredClone(validTimeline);
    futureTimeline.reference_date = "2026-10-05";
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(futureTimeline), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadTimelinePuzzle("pt-BR", "/base", "2026-09-30")).rejects.toEqual(
      new TimelineArtifactError("missing")
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/timeline.daily.json?d=2026-09-30");
    expect(fetch).toHaveBeenCalledWith("/base/data/next/timeline.daily.json");
  });

  it("throws missing when root artifact is 404 and next/ has invalid schema", async () => {
    const invalidTimeline = { not: "a valid timeline" };
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(invalidTimeline), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadTimelinePuzzle("pt-BR", "/base", "2026-09-30")).rejects.toEqual(
      new TimelineArtifactError("missing")
    );
  });

  it("throws missing when root artifact is 404 and next/ has malformed JSON", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response("{ malformed", { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadTimelinePuzzle("pt-BR", "/base", "2026-09-30")).rejects.toEqual(
      new TimelineArtifactError("missing")
    );
  });

  it("throws missing when root artifact is 404 and next/ fetch throws a network error", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/next/")) {
        throw new Error("Network offline");
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(loadTimelinePuzzle("pt-BR", "/base", "2026-09-30")).rejects.toEqual(
      new TimelineArtifactError("missing")
    );
  });

  it("rejects non-ok HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
    await expect(loadTimelinePuzzle("pt-BR")).rejects.toEqual(new TimelineArtifactError("invalid"));
  });

  it("rejects invalid JSON response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadTimelinePuzzle("pt-BR")).rejects.toEqual(new TimelineArtifactError("invalid"));
  });

  it("rejects when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network offline")));
    await expect(loadTimelinePuzzle("pt-BR")).rejects.toEqual(new TimelineArtifactError("invalid"));
  });

  it("rejects a timeline with invalid schema version", () => {
    const invalid = structuredClone(validTimeline) as Record<string, unknown>;
    invalid.schema_version = "kpop-timeline-puzzle-v2";
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects a timeline with fewer than 4 events", () => {
    const invalid = structuredClone(validTimeline);
    invalid.events = invalid.events.slice(0, 3);
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects a timeline with more than 6 events", () => {
    const invalid = structuredClone(validTimeline);
    const extra1 = structuredClone(invalid.events[0]!);
    extra1.id = "timeline-extra-1";
    const extra2 = structuredClone(invalid.events[0]!);
    extra2.id = "timeline-extra-2";
    invalid.events.push(extra1, extra2);
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects a timeline with duplicate event IDs", () => {
    const invalid = structuredClone(validTimeline);
    invalid.events[1]!.id = invalid.events[0]!.id;
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects an event with invalid event_type", () => {
    const invalid = structuredClone(validTimeline);
    invalid.events[0]!.event_type = "invalid_type";
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects an event when year does not match date prefix", () => {
    const invalid = structuredClone(validTimeline);
    invalid.events[0]!.year = 2005;
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects an event with invalid entity QID", () => {
    const invalid = structuredClone(validTimeline);
    invalid.events[0]!.entity_id = "P12345";
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects an event with non-https evidence source URL", () => {
    const invalid = structuredClone(validTimeline);
    invalid.events[0]!.evidence[0]!.source_url = "http://insecure.example.com";
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects an invalid reference date", () => {
    const invalid = structuredClone(validTimeline);
    invalid.reference_date = "2026-02-31";
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects invalid puzzle_id hash", () => {
    const invalid = structuredClone(validTimeline);
    invalid.puzzle_id = "not-a-64-char-hex";
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("rejects a timeline when theme_description is omitted", () => {
    const invalid = structuredClone(validTimeline) as Record<string, unknown>;
    delete invalid.theme_description;
    expect(isTimelinePuzzle(invalid)).toBe(false);
  });

  it("accepts valid YYYY-MM and YYYY-MM-DD dates in events", () => {
    const puzzleWithMonth = structuredClone(validTimeline);
    puzzleWithMonth.events[0]!.date = "1997-03";
    expect(isTimelinePuzzle(puzzleWithMonth)).toBe(true);

    const puzzleWithDay = structuredClone(validTimeline);
    puzzleWithDay.events[0]!.date = "1997-03-15";
    expect(isTimelinePuzzle(puzzleWithDay)).toBe(true);
  });

  it("rejects out-of-range event years (<1980 or >2035)", () => {
    const invalidBefore = structuredClone(validTimeline);
    invalidBefore.events[0]!.year = 1979;
    invalidBefore.events[0]!.date = "1979";
    expect(isTimelinePuzzle(invalidBefore)).toBe(false);

    const invalidAfter = structuredClone(validTimeline);
    invalidAfter.events[0]!.year = 2036;
    invalidAfter.events[0]!.date = "2036";
    expect(isTimelinePuzzle(invalidAfter)).toBe(false);
  });

  it("rejects invalid calendar dates in events", () => {
    const invalidMonth = structuredClone(validTimeline);
    invalidMonth.events[0]!.date = "1997-13";
    expect(isTimelinePuzzle(invalidMonth)).toBe(false);

    const invalidDay = structuredClone(validTimeline);
    invalidDay.events[0]!.date = "1997-02-30";
    expect(isTimelinePuzzle(invalidDay)).toBe(false);

    const invalidLeapDay = structuredClone(validTimeline);
    invalidLeapDay.events[0]!.date = "1997-02-29";
    expect(isTimelinePuzzle(invalidLeapDay)).toBe(false);
  });

  it("rejects unrecognized or extra properties on root or events", () => {
    const invalidRoot = structuredClone(validTimeline) as Record<string, unknown>;
    invalidRoot.extra_property = "unrecognized";
    expect(isTimelinePuzzle(invalidRoot)).toBe(false);

    const invalidEvent = structuredClone(validTimeline);
    (invalidEvent.events[0]! as Record<string, unknown>).extra_property = "unrecognized";
    expect(isTimelinePuzzle(invalidEvent)).toBe(false);
  });
});
