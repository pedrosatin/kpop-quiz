import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import published from "../../public/data/crossword-pilot.json";
import {
  CROSSWORD_CELL_KEYS,
  CROSSWORD_ENTRY_KEYS,
  CROSSWORD_MAX_ENTRIES,
  CROSSWORD_MAX_SIDE,
  CROSSWORD_MIN_ENTRIES,
  CROSSWORD_MODE,
  CROSSWORD_PUZZLE_ID,
  CROSSWORD_ROOT_KEYS,
  CROSSWORD_SCHEMA_VERSION,
  CROSSWORD_SOURCE_KEYS,
  CrosswordArtifactError,
  crosswordChecksum,
  loadCrosswordPuzzle,
  validateCrosswordDaily,
  validateCrosswordPuzzle,
  CROSSWORD_DAILY_BOARD_KEYS,
  CROSSWORD_DAILY_ROOT_KEYS,
  CROSSWORD_DAILY_SCHEMA_VERSION,
  type CrosswordPuzzle,
} from "./crossword";
import { buildCrosswordDaily, buildCrosswordOmissionRecord, buildOmittedCrosswordDaily } from "../test/crossword-daily-fixture";

// The schema and the rejection cases are shared with the Python validator
// (tests/test_crossword_schema.py), so both sides reject the same artifacts.
const REPO = join(import.meta.dirname, "../../..");
const schema = JSON.parse(readFileSync(join(REPO, "schemas/crossword-pilot-v1.json"), "utf-8"));
const dailySchema = JSON.parse(readFileSync(join(REPO, "schemas/crossword-daily-v1.json"), "utf-8"));
const TODAY = "2026-10-29";
const board = published as unknown as CrosswordPuzzle;
const { cases } = JSON.parse(readFileSync(join(REPO, "tests/fixtures/crossword_invalid_cases.json"), "utf-8")) as {
  cases: Array<{ name: string; rehash?: boolean; ops: Array<{ op: "set" | "append"; path: Array<string | number>; value: unknown }> }>;
};

async function applyCase(payload: unknown, testCase: (typeof cases)[number]): Promise<unknown> {
  const result = structuredClone(payload) as Record<string | number, unknown>;
  for (const op of testCase.ops) {
    const parents = op.path.slice(0, -1);
    const last = op.path[op.path.length - 1]!;
    let target = result as Record<string | number, unknown>;
    for (const key of parents) target = target[key] as Record<string | number, unknown>;
    if (op.op === "set") target[last] = op.value;
    else (target[last] as unknown[]).push(op.value);
  }
  if (testCase.rehash ?? true) {
    (result as unknown as CrosswordPuzzle).dataset_version = await crosswordChecksum(result as unknown as CrosswordPuzzle);
  }
  return result;
}

describe("crossword artifact contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the constants and field sets of the JSON schema", () => {
    const props = schema.properties;
    expect(props.schema_version.const).toBe(CROSSWORD_SCHEMA_VERSION);
    expect(props.mode.const).toBe(CROSSWORD_MODE);
    expect(props.puzzle_id.const).toBe(CROSSWORD_PUZZLE_ID);
    expect(props.rows.maximum).toBe(CROSSWORD_MAX_SIDE);
    expect(props.cols.maximum).toBe(CROSSWORD_MAX_SIDE);
    expect(props.entries.minItems).toBe(CROSSWORD_MIN_ENTRIES);
    expect(props.entries.maxItems).toBe(CROSSWORD_MAX_ENTRIES);
    expect([...schema.required].sort()).toEqual([...CROSSWORD_ROOT_KEYS].sort());
    expect([...schema.$defs.entry.required].sort()).toEqual([...CROSSWORD_ENTRY_KEYS].sort());
    expect([...schema.$defs.source.required].sort()).toEqual([...CROSSWORD_SOURCE_KEYS].sort());
    expect([...schema.$defs.cell.required].sort()).toEqual([...CROSSWORD_CELL_KEYS].sort());
  });

  it("accepts the published audited board", async () => {
    await expect(validateCrosswordPuzzle(structuredClone(published))).resolves.toBeTruthy();
  });

  it("keeps digits in answers", async () => {
    const numeric = structuredClone(published) as unknown as CrosswordPuzzle;
    numeric.entries[1]!.canonical_name = "Bt0B";
    numeric.entries[1]!.answer = "BT0B";
    numeric.cells.find((c) => c.row === 2 && c.col === 0)!.answer = "0";
    numeric.dataset_version = await crosswordChecksum(numeric);
    await expect(validateCrosswordPuzzle(numeric)).resolves.toBe(numeric);
  });

  it.each(cases.map((c) => [c.name, c] as const))("rejects %s like the Python validator", async (_name, testCase) => {
    const payload = await applyCase(published, testCase);
    await expect(validateCrosswordPuzzle(payload)).rejects.toBeInstanceOf(CrosswordArtifactError);
  });

  it("uses the constants and field sets of the daily JSON schema", () => {
    expect(dailySchema.properties.schema_version.const).toBe(CROSSWORD_DAILY_SCHEMA_VERSION);
    expect([...dailySchema.required].sort()).toEqual([...CROSSWORD_DAILY_ROOT_KEYS].sort());
  });

  it("accepts a ready envelope and plays it under the envelope checksum", async () => {
    const daily = await buildCrosswordDaily(board, TODAY, ["Q1", "Q2", "Q3"]);
    const result = await validateCrosswordDaily(daily);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.puzzle.dataset_version).toBe(daily.dataset_version);
    expect(result.puzzle.reference_date).toBe(TODAY);
    expect(result.puzzle.entries).toEqual(board.entries);
    await expect(validateCrosswordDaily(await buildOmittedCrosswordDaily(TODAY))).resolves.toEqual({ status: "omitted", reference_date: TODAY });
  });

  it("rejects a tampered envelope, a repeated group of the eve and a bad board", async () => {
    const daily = await buildCrosswordDaily(board, TODAY);
    await expect(validateCrosswordDaily({ ...daily, seed: "other" })).rejects.toBeInstanceOf(CrosswordArtifactError);
    // A canonical history whose only fault is a group of the board.
    const repeat = await buildCrosswordDaily(board, TODAY, [board.vocabulary[0]!, "Q1", "Q2"]);
    await expect(validateCrosswordDaily(repeat)).rejects.toBeInstanceOf(CrosswordArtifactError);
    const crossing = structuredClone(board);
    crossing.cells[0]!.answer = "Z";
    await expect(validateCrosswordDaily(await buildCrosswordDaily(crossing, TODAY))).rejects.toBeInstanceOf(CrosswordArtifactError);
    const proofless = structuredClone(daily) as { puzzle: Record<string, unknown> };
    proofless.puzzle.proof = { solutions: 2, complete: true, nodes: 1 };
    const resealed = { ...proofless, dataset_version: await crosswordChecksum(proofless) };
    await expect(validateCrosswordDaily(resealed)).rejects.toBeInstanceOf(CrosswordArtifactError);
    expect(Object.keys((daily as { puzzle: object }).puzzle).sort()).toEqual([...CROSSWORD_DAILY_BOARD_KEYS].sort());
  });

  it("loads only today's board, from data/ first and then data/next/", async () => {
    const today = await buildCrosswordDaily(board, TODAY);
    const yesterday = await buildCrosswordDaily(board, "2026-10-28");
    const serve = (main: unknown, next: unknown) => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        // No publication record in these cases: see the record test below.
        const body = String(url).includes("crossword-publication.") ? 404 : String(url).includes("/next/") ? next : main;
        if (body === 404) return Promise.resolve(new Response("", { status: 404 }));
        if (body === 500) return Promise.resolve(new Response("", { status: 500 }));
        return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body)));
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const fetchMock = serve(today, yesterday);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).resolves.toMatchObject({ dataset_version: today.dataset_version });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/data/crossword.daily.json");
    serve(yesterday, today);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).resolves.toMatchObject({ reference_date: TODAY });
    serve(yesterday, 404);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "missing" });
    serve(yesterday, await buildOmittedCrosswordDaily(TODAY));
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "omitted" });
    serve(404, 404);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "missing" });
    serve("not json", 404);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "invalid" });
    serve(500, today);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).resolves.toMatchObject({ reference_date: TODAY });
    // The pilot contract is not a daily envelope.
    serve(published, 404);
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("tells a day whose generation failed from one not published yet by today's record", async () => {
    const yesterday = await buildCrosswordDaily(board, "2026-10-28");
    const played = { ...buildCrosswordOmissionRecord(TODAY), state: "played", qids: [...board.vocabulary], reason: null };
    const serve = (files: Record<string, unknown>) => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const body = files[String(url)];
        if (body === undefined) return Promise.resolve(new Response("", { status: 404 }));
        return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body)));
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };
    const record = `crossword-publication.${TODAY}.json`;
    // The history of the day before was missing: only the record was published.
    serve({ "/data/crossword.daily.json": yesterday, [`/data/next/${record}`]: buildCrosswordOmissionRecord(TODAY) });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "unavailable" });
    // A generation error, confirmed in data/ after promotion.
    const failed = buildCrosswordOmissionRecord(TODAY, "generation failed: database is locked");
    const fetchMock = serve({ [`/data/${record}`]: failed });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/data/crossword.daily.json", "/data/next/crossword.daily.json", `/data/${record}`]);
    // Nothing for today anywhere: not published yet.
    serve({ "/data/crossword.daily.json": yesterday, "/data/crossword-publication.2026-10-28.json": played });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "missing" });
    // A record that says played without its board, or a broken record, fails closed.
    serve({ [`/data/next/${record}`]: played });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "invalid" });
    serve({ [`/data/${record}`]: { ...failed, reference_date: "2026-10-28" } });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "invalid" });
    serve({ [`/data/${record}`]: { ...failed, reason: null } });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "invalid" });
    // An envelope of today, ready or omitted, wins over the record.
    serve({ "/data/next/crossword.daily.json": await buildOmittedCrosswordDaily(TODAY), [`/data/${record}`]: failed });
    await expect(loadCrosswordPuzzle("/", undefined, TODAY)).rejects.toMatchObject({ kind: "omitted" });
  });

  it("checks the history and the attempt accounting of the envelope like validate_published()", async () => {
    const reseal = async (envelope: Record<string, unknown>) => ({ ...envelope, dataset_version: await crosswordChecksum(envelope) });
    const daily = await buildCrosswordDaily(board, TODAY);
    const omitted = await buildOmittedCrosswordDaily(TODAY);
    const rejected = [
      // History: wrong date, bootstrap dated the day before, unsorted QIDs, state and QIDs disagree.
      { ...daily, previous: { state: "omitted", date: "2026-10-27", qids: [] } },
      { ...daily, previous: { state: "bootstrap", date: "2026-10-28", qids: [] } },
      { ...daily, previous: { state: "played", date: "2026-10-28", qids: ["Q9", "Q8", "Q7"] } },
      { ...daily, previous: { state: "played", date: "2026-10-28", qids: ["Q7"] } },
      { ...daily, previous: { state: "omitted", date: "2026-10-28", qids: ["Q7"] } },
      // Accounting: a ready board after rejections it does not count, budgets, unknown rejection.
      { ...daily, attempts: 2 },
      { ...daily, attempts: 201, rejections: { placement: 200 } },
      { ...daily, limits: { attempts: 0, placement_nodes: 5000, proof_nodes: 10000 } },
      { ...daily, attempts: 2, rejections: { other: 1 } },
      { ...daily, seed: "" },
      { ...daily, status: "pending" },
      // An omission that did not spend every attempt.
      { ...omitted, attempts: 1, rejections: { placement: 1 } },
      { ...omitted, rejections: { placement: 1 } },
    ];
    for (const envelope of rejected) {
      await expect(validateCrosswordDaily(await reseal(envelope))).rejects.toBeInstanceOf(CrosswordArtifactError);
    }
    await expect(validateCrosswordDaily(await reseal({ ...daily, previous: { state: "bootstrap", date: TODAY, qids: [] } }))).resolves.toMatchObject({ status: "ready" });
    await expect(validateCrosswordDaily(await reseal({ ...daily, attempts: 3, rejections: { placement: 1, validation: 1 } }))).resolves.toMatchObject({ status: "ready" });
  });
});
