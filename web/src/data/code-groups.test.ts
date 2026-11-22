import { afterEach, describe, expect, it, vi } from "vitest";
import daily from "../../public/data/code-groups.daily.json";
import pilot from "../../public/data/code-groups.pilot.json";
import { CodeGroupsArtifactError, isCodeGroupsPuzzle, loadCodeGroupsPuzzle } from "./code-groups";
import { guardAfterChange, guardRows, withoutEachField, type GuardCase } from "../test/guard-table";

/** Gives the first symbol `revisionId` and the Wikidata link that cites it. */
const firstSymbolRevision = (p: any, revisionId: number) => {
  const symbol = p.symbols[0];
  symbol.source.revision_id = revisionId;
  symbol.source.url = `https://www.wikidata.org/w/index.php?title=${symbol.qid}&oldid=${revisionId}`;
};

const CODE_GROUPS_CASES: GuardCase[] = [
  ["the pilot", () => {}, true],
  ["an extra key", (p) => { p.extra = 1; }, false],
  ...withoutEachField(["schema_version", "mode", "puzzle_id", "dataset_version", "reference_date", "seed", "symbols", "secret", "max_attempts"]),
  ["another schema", (p) => { p.schema_version = "code-groups-pilot-v2"; }, false],
  ["another mode", (p) => { p.mode = "daily"; }, false],
  ["nine attempts", (p) => { p.max_attempts = 9; }, false],
  ["a blank puzzle id", (p) => { p.puzzle_id = " "; }, false],
  ["a short puzzle id", (p) => { p.puzzle_id = "abc"; }, false],
  ["an uppercase dataset version", (p) => { p.dataset_version = "A".repeat(64); }, false],
  ["a blank seed", (p) => { p.seed = " "; }, false],
  ["a numeric seed", (p) => { p.seed = 1; }, false],
  ["another seed", (p) => { p.seed = "x"; }, true],
  ["a reference date that does not exist", (p) => { p.reference_date = "2026-02-30"; }, false],
  ["a reference date before year 100", (p) => { p.reference_date = "0099-01-01"; }, true],
  ["five symbols", (p) => { p.symbols.pop(); }, false],
  ["a symbol that is null", (p) => { p.symbols[0] = null; }, false],
  ["a symbol with an extra key", (p) => { p.symbols[0].extra = 1; }, false],
  ["a symbol whose id is not a QID", (p) => { p.symbols[0].qid = "Q0"; }, false],
  ["a symbol with a blank name", (p) => { p.symbols[0].name = " "; }, false],
  ["a source with an extra key", (p) => { p.symbols[0].source.extra = 1; }, false],
  ["a source that is null", (p) => { p.symbols[0].source = null; }, false],
  ["revision 0", (p) => { firstSymbolRevision(p, 0); }, false],
  ["revision 1", (p) => { firstSymbolRevision(p, 1); }, true],
  ["the largest safe revision", (p) => { firstSymbolRevision(p, Number.MAX_SAFE_INTEGER); }, true],
  ["a revision past the safe integers", (p) => { firstSymbolRevision(p, 2 ** 53); }, false],
  ["a fractional revision", (p) => { firstSymbolRevision(p, 1.5); }, false],
  ["another locator", (p) => { p.symbols[0].source.locator = "claims.P279"; }, false],
  ["a link to another revision", (p) => { p.symbols[0].source.url += "1"; }, false],
  ["a repeated symbol", (p) => { p.symbols[1] = structuredClone(p.symbols[0]); }, false],
  ["a secret of three", (p) => { p.secret.pop(); }, false],
  ["a secret that repeats a group", (p) => { p.secret[1] = p.secret[0]; }, false],
  ["a secret outside the symbols", (p) => { p.secret[0] = "Q1"; }, false],
];

describe("isCodeGroupsPuzzle fields", () => {
  it.each(guardRows(CODE_GROUPS_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(pilot, change, isCodeGroupsPuzzle)).toBe(accepted);
  });

  it.each([null, [], "puzzle"])("refuses %j", (value) => {
    expect(isCodeGroupsPuzzle(value)).toBe(false);
  });

});

/**
 * reference_date follows shared isLenientIsoDate (T00:00:00Z round-trip).
 * Year 0099 is accepted; impossible calendar days are refused without throwing.
 */
const CODE_GROUPS_CALENDAR_DATES = [
  { value: "2026-11-14", accepted: true, label: "year 2026" },
  { value: "2024-02-29", accepted: true, label: "leap day 2024" },
  { value: "2023-02-29", accepted: false, label: "Feb 29 in a common year" },
  { value: "2026-02-30", accepted: false, label: "Feb 30" },
  { value: "2026-13-01", accepted: false, label: "month 13" },
  { value: "2026-00-01", accepted: false, label: "month 00" },
  { value: "2026-01-00", accepted: false, label: "day 00" },
  { value: "2026-01-32", accepted: false, label: "day 32" },
  { value: "0099-01-01", accepted: true, label: "year 0099" },
] as const;

describe("code-groups calendar date policy", () => {
  it.each(CODE_GROUPS_CALENDAR_DATES)("$label ($value): accepted is $accepted", ({ value, accepted }) => {
    expect(guardAfterChange(pilot, (p) => { p.reference_date = value; }, isCodeGroupsPuzzle)).toBe(accepted);
  });
});

describe("code-groups next/ fallback when the main file is missing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads next/ after midnight when its reference_date is today", async () => {
    const today = daily.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(daily), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);
    const result = await loadCodeGroupsPuzzle("pt-BR", "/base", today);
    expect(result.puzzle_id).toBe(daily.puzzle_id);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/code-groups.daily.json");
  });

  it("keeps missing before midnight when next/ is still tomorrow", async () => {
    const tomorrow = structuredClone(daily);
    tomorrow.reference_date = "2099-01-02";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(tomorrow), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadCodeGroupsPuzzle("pt-BR", "/base", "2099-01-01")).rejects.toEqual(
      new CodeGroupsArtifactError("missing"),
    );
  });

  it("keeps missing when next/ is also 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadCodeGroupsPuzzle("pt-BR", "/base", daily.reference_date)).rejects.toEqual(
      new CodeGroupsArtifactError("missing"),
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/next/code-groups.daily.json");
  });

  it("keeps missing when next/ has an invalid artifact", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify({ not: "code-groups" }), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadCodeGroupsPuzzle("pt-BR", "/base", daily.reference_date)).rejects.toEqual(
      new CodeGroupsArtifactError("missing"),
    );
  });
});
