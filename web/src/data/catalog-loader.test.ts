// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogArtifactError, clearCatalogCache, eligibleQuestions, loadCatalogAvailability, loadQuizCatalog, replayStatus,
} from "./catalog-loader";
import { QuizArtifactError } from "./session-loader";

const DIR = path.resolve(__dirname, "../tests/fixtures/catalog");
const read = (name: string) => fs.readFileSync(path.join(DIR, name));
const manifestFixture = JSON.parse(read("catalog-manifest-v1.json").toString("utf-8"));

type Json = Record<string, any>;

async function hash(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function catalogVersion(manifest: Json): Promise<string> {
  const lines = ["kpop-quiz-catalog-manifest-v1", manifest.dataset_version,
    ...Object.keys(manifest.shards).sort().map((key) => `${key}:${manifest.shards[key].sha256}`)];
  return hash(lines.join("\n"));
}

interface World {
  files: Map<string, Uint8Array | string>;
  manifest: Json;
}

/** The published directory as the fixture has it, ready to be altered before it is "served". */
function publishedWorld(): World {
  const files = new Map<string, Uint8Array | string>();
  for (const name of fs.readdirSync(DIR)) files.set(name, read(name));
  return { files, manifest: structuredClone(manifestFixture) };
}

/** Replace one shard by a changed copy and keep the manifest consistent with its new bytes. */
async function alterShard(world: World, key: string, change: (shard: Json) => void, options: { keepCounts?: boolean } = {}) {
  const entry = world.manifest.shards[key];
  const shard = JSON.parse(Buffer.from(world.files.get(entry.path) as Uint8Array).toString("utf-8"));
  change(shard);
  const bytes = new TextEncoder().encode(`${JSON.stringify(shard)}\n`);
  entry.sha256 = await hash(bytes);
  entry.path = `catalog.${key}.${entry.sha256}.json`;
  if (!options.keepCounts) {
    entry.questions = shard.questions.length;
    entry.pools = Object.fromEntries(Object.entries(shard.pools).map(([pool, indexes]) => [pool, (indexes as number[]).length]));
  }
  world.files.set(entry.path, bytes);
  world.manifest.catalog_version = await catalogVersion(world.manifest);
}

function serve(world: World, overrides: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn(async (input: string) => {
    const name = input.split("/data/")[1]!;
    if (overrides[name]) return overrides[name]!();
    if (name === "catalog-manifest-v1.json") return new Response(JSON.stringify(world.manifest));
    const bytes = world.files.get(name);
    return bytes ? new Response(bytes as BodyInit) : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function refused(promise: Promise<unknown>, kind: "missing" | "invalid", reason: RegExp) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CatalogArtifactError);
  expect(error).toBeInstanceOf(QuizArtifactError);
  expect((error as CatalogArtifactError).kind).toBe(kind);
  expect((error as CatalogArtifactError).reason).toMatch(reason);
}

describe("published question catalog", () => {
  beforeEach(() => clearCatalogCache());
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the catalog the Python publisher wrote", async () => {
    const fetchMock = serve(publishedWorld());
    const catalog = await loadQuizCatalog("pt-BR", "assisted", "/base");
    expect(catalog).toMatchObject({
      catalogVersion: manifestFixture.catalog_version, datasetVersion: manifestFixture.dataset_version,
      locale: "pt-BR", playMode: "assisted",
    });
    expect(catalog.questions).toHaveLength(12);
    expect(catalog.questions.every((q) => q.language === "pt-BR" && q.play_mode === "assisted")).toBe(true);
    expect(catalog.questions.every((q) => q.evidence.length > 0)).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/base/data/catalog-manifest-v1.json",
      `/base/data/${manifestFixture.shards["pt-BR.assisted"].path}`,
    ]);
  });

  it("loads every language and play mode", async () => {
    serve(publishedWorld());
    for (const locale of ["pt-BR", "en"] as const) {
      for (const mode of ["assisted", "standard", "expert"] as const) {
        const catalog = await loadQuizCatalog(locale, mode, "/");
        expect(catalog.questions).toHaveLength(manifestFixture.shards[`${locale}.${mode}`].questions);
      }
    }
  });

  it("reports the eligible questions and replay status of every filter from the manifest alone", async () => {
    const fetchMock = serve(publishedWorld());
    const availability = await loadCatalogAvailability("/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(availability.catalogVersion).toBe(manifestFixture.catalog_version);
    expect(availability.shards["en.standard"]!["all"]).toEqual({ eligible: 12, replay: "ok" });
    expect(availability.shards["en.standard"]!["decade.2000"]).toEqual({ eligible: 12, replay: "ok" });
    expect(availability.shards["en.standard"]!["decade.1990"]).toEqual({ eligible: 0, replay: "unavailable" });
  });

  it("classifies a pool by whether it can fill a round of ten without repeating the same set", () => {
    expect([replayStatus(11), replayStatus(10), replayStatus(9), replayStatus(0)]).toEqual(["ok", "repeats", "unavailable", "unavailable"]);
  });

  it("selects the questions a filter allows, each once", async () => {
    serve(publishedWorld());
    const catalog = await loadQuizCatalog("en", "standard", "/");
    expect(eligibleQuestions(catalog)).toHaveLength(12);
    expect(eligibleQuestions(catalog, [2000])).toHaveLength(12);
    expect(eligibleQuestions(catalog, [2000, 2020])).toHaveLength(12);
    expect(eligibleQuestions(catalog, [1990])).toEqual([]);
    const semantic = eligibleQuestions(catalog).map((q) => q.semantic_id);
    expect(new Set(semantic).size).toBe(semantic.length);
  });

  it("does not parse a shard it has already validated, yet still reads the manifest every time", async () => {
    const world = publishedWorld();
    const fetchMock = serve(world);
    const first = await loadQuizCatalog("en", "standard", "/");
    const second = await loadQuizCatalog("en", "standard", "/");
    expect(second).toBe(first);
    expect(fetchMock.mock.calls.map(([url]) => url.split("/data/")[1]).filter((name) => name!.startsWith("catalog.en.standard"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("catalog-manifest-v1.json"))).toHaveLength(2);
  });

  it("notices a newer catalog through the manifest", async () => {
    const world = publishedWorld();
    serve(world);
    const first = await loadQuizCatalog("en", "standard", "/");
    await alterShard(world, "en.standard", (shard) => { shard.questions[0].explanation += " (revised)"; });
    const second = await loadQuizCatalog("en", "standard", "/");
    expect(second).not.toBe(first);
    expect(second.catalogVersion).not.toBe(first.catalogVersion);
    expect(second.questions[0]!.explanation).toContain("(revised)");
  });

  describe("absent or unreadable artifacts", () => {
    it("reports a missing manifest as missing, never as an empty catalog", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);
      await refused(loadQuizCatalog("en", "standard", "/"), "missing", /manifest not published/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports a failed request as missing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
      await refused(loadQuizCatalog("en", "standard", "/"), "missing", /manifest request failed/);
    });

    it("reports a server error on the manifest as invalid", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /manifest status 500/);
    });

    it("reports a manifest that is not JSON as invalid", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /not JSON/);
    });

    it("reports a missing shard as missing", async () => {
      const world = publishedWorld();
      world.files.delete(manifestFixture.shards["en.standard"].path);
      serve(world);
      await refused(loadQuizCatalog("en", "standard", "/"), "missing", /shard not published/);
    });

    it("reports a server error on a shard as invalid", async () => {
      const path = manifestFixture.shards["en.standard"].path;
      serve(publishedWorld(), { [path]: () => new Response("boom", { status: 503 }) });
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard status 503/);
    });

    it("never falls back to sessions or another manifest", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(loadQuizCatalog("en", "standard", "/")).rejects.toBeInstanceOf(CatalogArtifactError);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/data/catalog-manifest-v1.json"]);
    });
  });

  describe("corrupted manifest", () => {
    it.each<[string, (manifest: Json) => void, RegExp]>([
      ["schema version", (m) => { m.schema_version = "kpop-quiz-catalog-manifest-v2"; }, /manifest schema/],
      ["extra field", (m) => { m.extra = true; }, /manifest fields/],
      ["missing field", (m) => { delete m.reference_date; }, /manifest fields/],
      ["dataset version", (m) => { m.dataset_version = "abc"; }, /manifest identity/],
      ["reference date", (m) => { m.reference_date = "2026-02-30"; }, /manifest identity/],
      ["catalog version", (m) => { m.catalog_version = "0".repeat(64); }, /catalog version/],
      ["missing shard", (m) => { delete m.shards["en.expert"]; }, /manifest shards/],
      ["extra shard", (m) => { m.shards["fr.standard"] = m.shards["en.standard"]; }, /manifest shards/],
      ["path traversal", (m) => { m.shards["en.standard"].path = `../${m.shards["en.standard"].path}`; }, /shard entry/],
      ["path of another shard", (m) => { m.shards["en.standard"].path = m.shards["pt-BR.standard"].path; }, /shard entry/],
      ["pool count", (m) => { delete m.shards["en.standard"].pools["decade.2000"]; }, /shard entry/],
      ["pool above questions", (m) => { m.shards["en.standard"].pools.all = 999; }, /shard entry/],
      ["shard field", (m) => { m.shards["en.standard"].extra = 1; }, /shard entry/],
    ])("refuses a manifest with a bad %s", async (_name, change, reason) => {
      const world = publishedWorld();
      change(world.manifest);
      const fetchMock = serve(world);
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", reason);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("corrupted shard", () => {
    const shardName = manifestFixture.shards["en.standard"].path as string;
    const bytes = () => new Uint8Array(read(shardName));

    it("refuses a changed byte", async () => {
      const changed = bytes();
      const mid = Math.floor(changed.length / 2);
      changed[mid] = (changed[mid] ?? 0) ^ 1;
      serve(publishedWorld(), { [shardName]: () => new Response(changed as BodyInit) });
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard hash/);
    });

    it("refuses a truncated shard", async () => {
      const truncated = bytes().slice(0, 1000);
      serve(publishedWorld(), { [shardName]: () => new Response(truncated as BodyInit) });
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard hash/);
    });

    it("refuses an empty shard", async () => {
      serve(publishedWorld(), { [shardName]: () => new Response("") });
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard hash/);
    });

    it("refuses bytes that are not JSON even when the hash matches", async () => {
      const world = publishedWorld();
      const junk = new TextEncoder().encode("not json\n");
      const entry = world.manifest.shards["en.standard"];
      entry.sha256 = await hash(junk);
      entry.path = `catalog.en.standard.${entry.sha256}.json`;
      world.files.set(entry.path, junk);
      world.manifest.catalog_version = await catalogVersion(world.manifest);
      serve(world);
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard is not JSON/);
    });

    it.each<[string, (shard: Json) => void, RegExp, boolean?]>([
      ["schema", (s) => { s.schema_version = "kpop-quiz-catalog-v0"; }, /shard schema/],
      ["extra field", (s) => { s.extra = 1; }, /shard fields/],
      ["dataset version", (s) => { s.dataset_version = "1".repeat(64); }, /shard dataset version/],
      ["reference date", (s) => { s.reference_date = "2020-01-01"; }, /shard reference date/],
      ["language", (s) => { s.language = "pt-BR"; }, /shard language/],
      ["play mode", (s) => { s.play_mode = "assisted"; }, /shard play mode/],
      ["question language", (s) => { s.questions[0].language = "pt-BR"; }, /shard question$/],
      ["question mode", (s) => { s.questions[0].play_mode = "assisted"; }, /shard question$/],
      ["question without evidence", (s) => { s.questions[0].evidence = []; }, /shard question$/],
      ["question answer", (s) => { s.questions[0].answer_option_id = "0".repeat(64); }, /shard question$/],
      ["duplicate id", (s) => { s.questions[1].id = s.questions[0].id; }, /question identity/],
      ["duplicate semantic id", (s) => { s.questions[1].semantic_id = s.questions[0].semantic_id; }, /question identity/],
      ["question order", (s) => { s.questions.reverse(); }, /question order/],
      ["pool index out of range", (s) => { s.pools.all[0] = 99; }, /shard pool all/],
      ["pool unsorted", (s) => { s.pools.all.reverse(); }, /shard pool all/],
      ["pool repeats an index", (s) => { s.pools.all[1] = s.pools.all[0]; }, /shard pool all/],
      ["pool of another decade", (s) => { s.pools["decade.1990"] = [0]; }, /decade/],
      ["missing pool", (s) => { delete s.pools["decade.2010"]; }, /shard pools/],
      ["question outside every pool", (s) => { s.pools.all.pop(); s.pools["decade.2000"].pop(); }, /outside every pool/, false],
    ])("refuses a shard with a bad %s even if the manifest hashes it", async (_name, change, reason, keepCounts = true) => {
      const world = publishedWorld();
      await alterShard(world, "en.standard", change, { keepCounts });
      serve(world);
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", reason);
    });

    it("refuses a shard whose questions do not match the count the manifest declares", async () => {
      const world = publishedWorld();
      await alterShard(world, "en.standard", (s) => { s.questions.pop(); s.pools.all.pop(); s.pools["decade.2000"].pop(); }, { keepCounts: true });
      serve(world);
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard questions/);
    });

    it("refuses a shard of another language filed under this key", async () => {
      const world = publishedWorld();
      const other = world.manifest.shards["pt-BR.standard"];
      const entry = world.manifest.shards["en.standard"];
      Object.assign(entry, { ...other, path: `catalog.en.standard.${other.sha256}.json` });
      world.files.set(entry.path, world.files.get(other.path)!);
      world.manifest.catalog_version = await catalogVersion(world.manifest);
      serve(world);
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard language/);
    });

    it("keeps refusing a corrupted shard on the next load instead of caching it", async () => {
      const changed = bytes();
      changed[10] = (changed[10] ?? 0) ^ 1;
      serve(publishedWorld(), { [shardName]: () => new Response(changed as BodyInit) });
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard hash/);
      await refused(loadQuizCatalog("en", "standard", "/"), "invalid", /shard hash/);
    });
  });
});
