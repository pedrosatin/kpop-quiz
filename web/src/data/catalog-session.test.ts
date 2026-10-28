// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCatalogCache, type QuizCatalog } from "./catalog-loader";
import {
  CatalogSelectionError,
  buildCatalogSession,
  digest,
  selectCatalogRound,
  selectQuestions,
  sessionQuestion,
} from "./catalog-session";
import type { QuizQuestion } from "../lib/quiz-types";

const DIR = path.resolve(__dirname, "../tests/fixtures/catalog");
const read = (name: string) => fs.readFileSync(path.join(DIR, name));
const manifestFixture = JSON.parse(read("catalog-manifest-v1.json").toString("utf-8"));

type Json = Record<string, any>;

async function hash(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digestBytes = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function publishedWorld(): World {
  const files = new Map<string, Uint8Array | string>();
  for (const name of fs.readdirSync(DIR)) files.set(name, read(name));
  return { files, manifest: structuredClone(manifestFixture) };
}

async function alterShard(world: World, key: string, change: (shard: Json) => void) {
  const entry = world.manifest.shards[key];
  const shard = JSON.parse(Buffer.from(world.files.get(entry.path) as Uint8Array).toString("utf-8"));
  change(shard);
  const bytes = new TextEncoder().encode(`${JSON.stringify(shard)}\n`);
  entry.sha256 = await hash(bytes);
  entry.path = `catalog.${key}.${entry.sha256}.json`;
  entry.questions = shard.questions.length;
  entry.pools = Object.fromEntries(
    Object.entries(shard.pools).map(([pool, indexes]) => [pool, (indexes as number[]).length]),
  );
  world.files.set(entry.path, bytes);
  world.manifest.catalog_version = await catalogVersion(world.manifest);
}

function serve(world: World) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const name = input.split("/data/")[1]!;
    if (name === "catalog-manifest-v1.json") return new Response(JSON.stringify(world.manifest));
    const bytes = world.files.get(name);
    return bytes ? new Response(bytes as BodyInit) : new Response(null, { status: 404 });
  }));
}

function memoryStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
  return store;
}

describe("catalog session selection", () => {
  beforeEach(() => {
    clearCatalogCache();
    memoryStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCatalogCache();
  });

  it("matches Python digest over joined parts", async () => {
    expect(await digest("a", "b", "c")).toBe(
      // echo -n $'a\x1fb\x1fc' | sha256sum
      await hash("a\x1fb\x1fc"),
    );
  });

  it("selects ten distinct semantic ids from a pool larger than ten", async () => {
    const world = publishedWorld();
    serve(world);
    const round = await selectCatalogRound({
      locale: "pt-BR",
      playMode: "assisted",
      avoidPrevious: false,
      baseUrl: "/",
    });
    expect(round.status).toBe("ok");
    expect(round.session.questions).toHaveLength(10);
    expect(new Set(round.session.questions.map((q) => q.semantic_id)).size).toBe(10);
    expect(round.session.config.language).toBe("pt-BR");
    expect(round.session.config.play_mode).toBe("assisted");
    expect(round.availableDecades).toEqual([2000]);
    expect(round.session.catalog_version).toBe(round.catalogVersion);
    expect(round.session.catalog_version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("avoids the immediately previous semantic set when another combination exists", async () => {
    const world = publishedWorld();
    serve(world);
    const first = await selectCatalogRound({
      locale: "en", playMode: "standard", avoidPrevious: false, baseUrl: "/",
    });
    const second = await selectCatalogRound({
      locale: "en", playMode: "standard", avoidPrevious: true, baseUrl: "/",
    });
    expect(second.status).toBe("ok");
    expect(second.semanticKey).not.toBe(first.semanticKey);
    // Order-only change would keep the same semantic key; a real new set differs.
    expect(new Set(second.session.questions.map((q) => q.semantic_id))).not.toEqual(
      new Set(first.session.questions.map((q) => q.semantic_id)),
    );
  });

  it("does not treat a reordered copy of the same ten as a new selection", async () => {
    const world = publishedWorld();
    serve(world);
    const round = await selectCatalogRound({
      locale: "en", playMode: "standard", avoidPrevious: false, baseUrl: "/",
    });
    const previous = new Set(round.session.questions.map((q) => q.semantic_id));
    const eligible = round.session.questions; // exactly the previous ten
    // With only those ten, status is repeats and the set stays the same.
    const again = await selectQuestions(
      eligible, round.catalogVersion, "seed", previous,
    );
    expect(again.status).toBe("repeats");
    expect(new Set(again.questions.map((q) => q.semantic_id))).toEqual(previous);
  });

  it("warns with repeats when exactly ten questions are eligible", async () => {
    const world = publishedWorld();
    await alterShard(world, "pt-BR.standard", (shard) => {
      shard.questions = shard.questions.slice(0, 10);
      shard.pools = {
        all: shard.questions.map((_: unknown, index: number) => index),
        "decade.1990": [],
        "decade.2000": shard.questions.map((_: unknown, index: number) => index),
        "decade.2010": [],
        "decade.2020": [],
      };
    });
    serve(world);
    const round = await selectCatalogRound({
      locale: "pt-BR", playMode: "standard", avoidPrevious: true, baseUrl: "/",
      previousSemanticIds: ["deadbeef".repeat(8)],
    });
    expect(round.status).toBe("repeats");
    expect(round.session.questions).toHaveLength(10);
  });

  it("reports unavailability without inventing duplicates when fewer than ten are eligible", async () => {
    const world = publishedWorld();
    await alterShard(world, "en.expert", (shard) => {
      shard.questions = shard.questions.slice(0, 9);
      shard.pools = {
        all: shard.questions.map((_: unknown, index: number) => index),
        "decade.1990": [],
        "decade.2000": shard.questions.map((_: unknown, index: number) => index),
        "decade.2010": [],
        "decade.2020": [],
      };
    });
    serve(world);
    await expect(selectCatalogRound({
      locale: "en", playMode: "expert", baseUrl: "/",
    })).rejects.toMatchObject({ kind: "unavailable" } satisfies Partial<CatalogSelectionError>);
  });

  it("keeps decade filters inside their own pool", async () => {
    const world = publishedWorld();
    serve(world);
    await expect(selectCatalogRound({
      locale: "pt-BR", playMode: "assisted", decades: [1990], baseUrl: "/",
    })).rejects.toMatchObject({ kind: "unavailable" });

    const round = await selectCatalogRound({
      locale: "pt-BR", playMode: "assisted", decades: [2000], baseUrl: "/",
    });
    expect(round.session.questions.every((q) => q.decades?.includes(2000))).toBe(true);
    expect(round.session.config.decade).toBe(2000);
  });

  it("builds an idempotent session id for the same catalog content and config", async () => {
    const world = publishedWorld();
    serve(world);
    const first = await selectCatalogRound({
      locale: "en", playMode: "assisted", avoidPrevious: false, baseUrl: "/",
    });
    clearCatalogCache();
    memoryStorage();
    const second = await selectCatalogRound({
      locale: "en", playMode: "assisted", avoidPrevious: false, baseUrl: "/",
      previousSemanticIds: null,
    });
    expect(second.session.session_id).toBe(first.session.session_id);
    expect(second.session.questions.map((q) => q.id)).toEqual(first.session.questions.map((q) => q.id));
  });

  it("shuffles options with the session seed while keeping the answer id", async () => {
    const world = publishedWorld();
    const entry = world.manifest.shards["en.standard"];
    const shard = JSON.parse(Buffer.from(world.files.get(entry.path) as Uint8Array).toString("utf-8"));
    const question = shard.questions[0] as QuizQuestion;
    const shuffled = await sessionQuestion(question, "seed-one");
    expect(shuffled.answer_option_id).toBe(question.answer_option_id);
    expect(new Set(shuffled.options.map((o) => o.id))).toEqual(new Set(question.options.map((o) => o.id)));
    const again = await sessionQuestion(question, "seed-one");
    expect(again.options.map((o) => o.id)).toEqual(shuffled.options.map((o) => o.id));
    const other = await sessionQuestion(question, "seed-two");
    // Different seed usually changes order; identity of the set stays.
    expect(new Set(other.options.map((o) => o.id))).toEqual(new Set(question.options.map((o) => o.id)));
  });

  it("surfaces a missing catalog as a clear selection error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(selectCatalogRound({
      locale: "pt-BR", playMode: "standard", baseUrl: "/",
    })).rejects.toMatchObject({ kind: "missing" });
  });

  it("surfaces a corrupted catalog as invalid without returning a partial round", async () => {
    const world = publishedWorld();
    world.manifest.catalog_version = "0".repeat(64);
    serve(world);
    await expect(selectCatalogRound({
      locale: "pt-BR", playMode: "standard", baseUrl: "/",
    })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects building a session with the wrong number of questions", async () => {
    const world = publishedWorld();
    serve(world);
    const round = await selectCatalogRound({
      locale: "en", playMode: "standard", baseUrl: "/",
    });
    const catalog = {
      catalogVersion: round.catalogVersion,
      datasetVersion: round.session.dataset_version,
      referenceDate: round.session.questions[0]!.reference_date,
      locale: "en" as const,
      playMode: "standard" as const,
      questions: round.session.questions,
      pools: {
        all: round.session.questions.map((_, i) => i),
        "decade.1990": [],
        "decade.2000": round.session.questions.map((_, i) => i),
        "decade.2010": [],
        "decade.2020": [],
      },
    } satisfies QuizCatalog;
    await expect(buildCatalogSession(catalog, round.session.questions.slice(0, 9), [])).rejects.toMatchObject({
      kind: "invalid",
    });
  });
});
