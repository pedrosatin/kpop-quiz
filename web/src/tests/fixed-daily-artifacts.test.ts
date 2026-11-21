// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { fixedGrid, FIXED_REPLACED_GRID_ID, serveFixedDaily, serveFixedGrid } from "../../e2e/helpers/fixed-daily";
import { isIntersectionGrid } from "../lib/quiz-types";
import { isGridPublication } from "../data/grid-publication";

const fixedDir = join(import.meta.dirname, "../../e2e/fixtures/fixed-data");

describe("frozen E2E daily artifacts", () => {
  it("grid.daily.json passes the real intersection-grid loader guard", () => {
    const grid = JSON.parse(readFileSync(join(fixedDir, "grid.daily.json"), "utf8"));
    expect(isIntersectionGrid(grid)).toBe(true);
    expect(grid.reference_date).toBe("2026-09-17");
  });

  it("a corrected-day publication for that board passes the publication guard", () => {
    const grid = JSON.parse(readFileSync(join(fixedDir, "grid.daily.json"), "utf8"));
    const publication = {
      schema_version: "kpop-grid-publication-v1",
      reference_date: grid.reference_date,
      grid_id: grid.grid_id,
      grid_reference_date: grid.reference_date,
      replaces: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    };
    expect(isGridPublication(publication)).toBe(true);
  });
});


describe("fixed grid route contract", () => {
  function pageHarness() {
    const routes = new Map<string, (route: { fulfill: ReturnType<typeof vi.fn> }) => unknown>();
    const context = {};
    const page = {
      clock: { install: vi.fn(), setFixedTime: vi.fn() },
      context: () => context,
      route: vi.fn(async (pattern: string, handler: (route: { fulfill: ReturnType<typeof vi.fn> }) => unknown) => {
        routes.set(pattern, handler);
      }),
    };
    return { page, routes };
  }

  it("serves a fixed normal day and hides live publication sidecars", async () => {
    const { page, routes } = pageHarness();
    const grid = await serveFixedDaily(page as unknown as Page, "grid");
    expect(grid).toBe(fixedGrid);
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date("2026-09-17T18:00:00Z") });
    const responses = new Map<string, unknown>();
    for (const [pattern, handler] of routes) {
      const fulfill = vi.fn((response) => responses.set(pattern, response));
      await handler({ fulfill });
    }
    expect(responses.get("**/data/grid.daily.json*")).toEqual({ json: fixedGrid });
    expect(responses.get("**/data/next/grid.daily.json*")).toEqual({ status: 404, body: "" });
    expect(responses.get("**/data/grid-publication.*")).toEqual({ status: 404, body: "" });
    expect([...routes.keys()].every((path) => path.includes("/data/") && path.includes("grid"))).toBe(true);
  });

  it("serves a valid correction sidecar with a fixed wall clock", async () => {
    const { page, routes } = pageHarness();
    await serveFixedGrid(page as unknown as Page, { guardClock: false, replaces: [FIXED_REPLACED_GRID_ID] });
    expect(page.clock.setFixedTime).toHaveBeenCalledWith(new Date("2026-09-17T18:00:00Z"));
    expect(page.clock.install).not.toHaveBeenCalled();
    const fulfill = vi.fn();
    await routes.get("**/data/grid-publication.2026-09-17.json*")!({ fulfill });
    const { json } = fulfill.mock.calls[0]![0];
    expect(isGridPublication(json)).toBe(true);
    expect(json.replaces).toEqual([FIXED_REPLACED_GRID_ID]);
  });

  it("rejects a malformed correction sidecar before serving it", async () => {
    const { page } = pageHarness();
    await expect(serveFixedGrid(page as unknown as Page, { replaces: ["invalid"] })).rejects.toThrow("publication failed");
  });
});
