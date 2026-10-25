import { afterEach, describe, expect, it, vi } from "vitest";
import { isGridPublication, isPublicationDate } from "./grid-publication";
import { GridArtifactError, loadIntersectionGrid } from "./grid-loader";
import grid from "../tests/fixtures/grid.daily.json";
const day = grid.reference_date;
const marker = { schema_version: "kpop-grid-publication-v1", reference_date: day, grid_reference_date: day, grid_id: grid.grid_id, replaces: ["b".repeat(64)] };
function serve(routes: Record<string, unknown>, mainStatus = 404) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.split("?")[0]!;
    if (path in routes) return new Response(JSON.stringify(routes[path]));
    return mainStatus === 200 ? new Response("<html/>", { headers: { "content-type": "text/html" } }) : new Response(null, { status: mainStatus });
  }));
}
afterEach(() => vi.unstubAllGlobals());
describe("grid publication boundary", () => {
  it.each([null, [], {}, { ...marker, extra: true }, { ...marker, schema_version: "v2" }, { ...marker, reference_date: "2026-02-30" }, { ...marker, grid_id: "<script>" }, { ...marker, replaces: [grid.grid_id] }, { ...marker, replaces: ["b".repeat(64), "b".repeat(64)] }, { ...marker, grid_reference_date: "2099-01-01" }, { ...marker, grid_reference_date: "2000-01-01" }, { ...marker, grid_id: null }, { ...marker, replaces: [null] }])("rejects invalid metadata %j", value => expect(isGridPublication(value)).toBe(false));
  it("validates real dates and nullable absence", () => {
    expect(isPublicationDate("2026-02-30")).toBe(false);
    expect(isPublicationDate("0000-01-01")).toBe(false);
    expect(isPublicationDate("../data")).toBe(false);
    expect(isPublicationDate(10)).toBe(false);
    expect(isGridPublication(marker)).toBe(true);
    expect(isGridPublication({ ...marker, grid_id: null, grid_reference_date: null })).toBe(true);
    expect(isGridPublication({ ...marker, replaces: [], grid_reference_date: "2000-01-01" })).toBe(true);
  });
  it.each([404, 200])("tombstone blocks rejected next even with main status %s", async status => {
    serve({ [`/base/data/grid-publication.${day}.json`]: { ...marker, grid_id: null, grid_reference_date: null }, "/base/data/next/grid.daily.json": grid }, status);
    await expect(loadIntersectionGrid("en", "/base", day)).rejects.toEqual(new GridArtifactError("missing"));
  });
  it("cached rejected main cannot bypass authoritative replacement in next", async () => {
    serve({ [`/data/grid-publication.${day}.json`]: marker, "/data/grid.daily.json": { ...grid, grid_id: "b".repeat(64) }, "/data/next/grid.daily.json": grid });
    expect((await loadIntersectionGrid("en", "/", day)).corrected).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`/data/grid-publication.${day}.json?d=${day}`, { cache: "no-store" });
  });
  it("validates next metadata at midnight and announces correction", async () => {
    serve({ [`/data/next/grid-publication.${day}.json`]: marker, "/data/next/grid.daily.json": grid });
    expect((await loadIntersectionGrid("en", "/", day)).corrected).toBe(true);
  });
  it("new day and legacy save do not announce correction", async () => {
    serve({ "/data/grid.daily.json": grid });
    expect((await loadIntersectionGrid("en", "/", "2099-01-01")).corrected).toBe(false);
  });
  it.each([{ ...marker, reference_date: "2000-01-01" }, { ...marker, replaces: ["bad"] }])("invalid publication is rejected before selecting a fallback", async value => {
    serve({ [`/data/grid-publication.${day}.json`]: value, "/data/grid.daily.json": grid });
    await expect(loadIntersectionGrid("en", "/", day)).rejects.toEqual(new GridArtifactError("invalid"));
  });
});
it("rejects next tombstone even if a stale main grid still exists", async () => {
  serve({ [`/data/next/grid-publication.${day}.json`]: { ...marker, grid_id: null, grid_reference_date: null }, "/data/grid.daily.json": grid });
  await expect(loadIntersectionGrid("en", "/", day)).rejects.toEqual(new GridArtifactError("missing"));
});
it("does not accept a structurally valid but unauthorized grid hash or date", async () => {
  for (const payload of [{ ...grid, grid_id: "c".repeat(64) }, { ...grid, reference_date: "2000-01-01" }]) {
    serve({ [`/data/grid-publication.${day}.json`]: marker, "/data/grid.daily.json": payload, "/data/next/grid.daily.json": payload });
    await expect(loadIntersectionGrid("en", "/", day)).rejects.toEqual(new GridArtifactError("missing"));
  }
});

it("a new day cannot revive a rejected cached grid from the previous date", async () => {
  serve({ [`/data/grid-publication.${day}.json`]: { ...marker, grid_id: null, grid_reference_date: null }, "/data/next/grid.daily.json": grid });
  await expect(loadIntersectionGrid("en", "/", "2099-01-01")).rejects.toEqual(new GridArtifactError("missing"));
});
it("a corrected prior-day grid may be reused without announcing a new-day correction", async () => {
  serve({ [`/data/grid-publication.${day}.json`]: marker, "/data/grid.daily.json": grid });
  expect((await loadIntersectionGrid("en", "/", "2099-01-01")).corrected).toBe(false);
});
