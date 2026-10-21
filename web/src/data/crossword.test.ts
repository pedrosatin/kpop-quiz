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
  validateCrosswordPuzzle,
  type CrosswordPuzzle,
} from "./crossword";

// The schema and the rejection cases are shared with the Python validator
// (tests/test_crossword_schema.py), so both sides reject the same artifacts.
const REPO = join(import.meta.dirname, "../../..");
const schema = JSON.parse(readFileSync(join(REPO, "schemas/crossword-pilot-v1.json"), "utf-8"));
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

  it("reports a 404 as missing and other failures as invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(loadCrosswordPuzzle("/")).rejects.toMatchObject({ kind: "missing" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
    await expect(loadCrosswordPuzzle("/")).rejects.toMatchObject({ kind: "invalid" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(loadCrosswordPuzzle("/")).rejects.toMatchObject({ kind: "invalid" });
  });
});
