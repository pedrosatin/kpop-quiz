import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkPartition,
  checkReport,
  collectTests,
  durationsFromReport,
  isParallelFile,
  packShards,
  plan,
  readDurations,
  testKey,
  testListLine,
} from "../../scripts/e2e-shards.mjs";

// Covers the split of the E2E suite into shards by recorded time
// (scripts/e2e-shards.mjs, run by the e2e jobs of .github/workflows/pages.yml).

type Report = Parameters<typeof collectTests>[0];
type Files = Record<string, string[]>;

const PARALLEL = 'test.describe.configure({ mode: "parallel" });\n';

/** A `playwright test --list --reporter=json` report; "a › b" nests b in describe a. */
function listing(files: Files): Report {
  return {
    config: { rootDir: "/e2e" },
    suites: Object.entries(files).map(([file, titles]) => {
      const suite: { title: string; file: string; specs: object[]; suites: object[] } = { title: file, file, specs: [], suites: [] };
      titles.forEach((title, index) => {
        const [first, second] = title.split(" › ");
        const spec = { title: second ?? first, line: index + 1, column: 1, tests: [{ projectName: "chromium", status: "skipped", results: [] }] };
        if (second === undefined) {
          suite.specs.push(spec);
        } else {
          suite.suites.push({ title: first, file, specs: [spec], suites: [] });
        }
      });
      return suite;
    }),
    errors: [],
  } as Report;
}

/** Resolves a test list the way Playwright's loadTestList matches it. */
function resolveList(report: Report, text: string): Report {
  const wanted = text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const tokens = line.split("\u203a").map((token) => token.trim());
    return { project: tokens[0]!.slice(1, -1), file: tokens[1]!, titles: tokens.slice(2) };
  });
  const matches = (file: string, titles: string[]) => wanted.some((w) => w.project === "chromium" && w.file === file
    && w.titles.length <= titles.length && w.titles.every((title, i) => title === titles[i]));
  const prune = (suite: any, file: string, titles: string[]): any => ({
    ...suite,
    specs: (suite.specs ?? []).filter((spec: any) => matches(file, [...titles, spec.title])),
    suites: (suite.suites ?? []).map((child: any) => prune(child, file, [...titles, child.title])),
  });
  return { ...report, suites: (report.suites ?? []).map((suite: any) => prune(suite, suite.file, [])) } as Report;
}

function durationsFile(entries: Record<string, number>) {
  return {
    version: 1,
    tests: Object.entries(entries).map(([id, duration]) => {
      const [file, ...titles] = id.split(" › ");
      return { project: "chromium", file: file!, titles, duration };
    }),
  };
}

describe("e2e shards", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-shards-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs plan() for every shard against a fake Playwright. */
  async function planAll(options: {
    files: Files;
    parallel?: string[];
    durations?: unknown;
    total: number;
    resolve?: (report: Report, text: string, list: string) => Report;
    listError?: boolean;
    edit?: (suite: Report) => void;
  }) {
    const suite = listing(options.files);
    options.edit?.(suite);
    const durationsPath = join(dir, "durations.json");
    if (options.durations !== undefined) {
      writeFileSync(durationsPath, typeof options.durations === "string" ? options.durations : JSON.stringify(options.durations));
    }
    const results = [];
    const logs: string[] = [];
    for (let shard = 1; shard <= options.total; shard += 1) {
      results.push(await plan({
        shard,
        total: options.total,
        durationsPath,
        outDir: join(dir, "lists"),
        listTests: async (list?: string) => {
          if (options.listError) throw new Error("playwright exited with 1");
          if (!list) return suite;
          const text = readFileSync(list, "utf8");
          return (options.resolve ?? resolveList)(suite, text, list);
        },
        readSource: async (file: string) => ((options.parallel ?? []).some((name) => file === join("/e2e", name)) ? PARALLEL : ""),
        log: (line: string) => logs.push(line),
      }));
    }
    return { results, logs, suite };
  }

  function listed(result: { arg: string }): string[] {
    const path = result.arg.replace("--test-list=", "");
    return readFileSync(path, "utf8").split("\n").filter(Boolean)
      .map((line) => line.replace("[chromium] › ", ""));
  }

  it("splits by recorded time when every test has history", async () => {
    const { results } = await planAll({
      files: { "a.spec.ts": ["a1", "a2", "a3", "a4"], "b.spec.ts": ["b1"] },
      parallel: ["a.spec.ts"],
      durations: durationsFile({
        "a.spec.ts › a1": 9000, "a.spec.ts › a2": 4000, "a.spec.ts › a3": 3000, "a.spec.ts › a4": 1500, "b.spec.ts › b1": 1000,
      }),
      total: 2,
    });
    expect(results.map((r) => r.mode)).toEqual(["recorded", "recorded"]);
    // 9 | 4+3+1.5+1: the longest test alone, the rest packed into the other shard.
    expect(listed(results[0]!)).toEqual(["a.spec.ts › a1"]);
    expect(listed(results[1]!)).toEqual(["a.spec.ts › a2", "a.spec.ts › a3", "a.spec.ts › a4", "b.spec.ts › b1"]);
    // Both shards wrote the same lists.
    expect(results[0]!.lists).toEqual(results[1]!.lists);
  });

  it("keeps a file that is not in parallel mode in one shard", async () => {
    const { results } = await planAll({
      files: { "serial.spec.ts": ["s1", "s2", "s3"], "p.spec.ts": ["p1", "p2"] },
      parallel: ["p.spec.ts"],
      durations: durationsFile({
        "serial.spec.ts › s1": 5000, "serial.spec.ts › s2": 5000, "serial.spec.ts › s3": 5000, "p.spec.ts › p1": 6000, "p.spec.ts › p2": 6000,
      }),
      total: 2,
    });
    // 15 for the whole file against 6 + 6 for the parallel tests.
    const shards = results.map((r) => listed(r));
    expect(shards[0]).toEqual(["serial.spec.ts › s1", "serial.spec.ts › s2", "serial.spec.ts › s3"]);
    expect(shards[1]).toEqual(["p.spec.ts › p1", "p.spec.ts › p2"]);
  });

  it("sends a test without history to the lightest shard", async () => {
    const { results, logs } = await planAll({
      files: { "a.spec.ts": ["a1", "a2", "a3", "new"] },
      parallel: ["a.spec.ts"],
      durations: durationsFile({ "a.spec.ts › a1": 10_000, "a.spec.ts › a2": 6000, "a.spec.ts › a3": 3000 }),
      total: 2,
    });
    expect(results.map((r) => r.mode)).toEqual(["recorded", "recorded"]);
    // 10 | 6+3: the new test (weighed at the median, 6) goes to the 9 s shard.
    expect(listed(results[0]!)).toEqual(["a.spec.ts › a1"]);
    expect(listed(results[1]!)).toEqual(["a.spec.ts › a2", "a.spec.ts › a3", "a.spec.ts › new"]);
    expect(logs.join("\n")).toContain("3 with history, 1 without");
  });

  it("ignores the history of a removed test", async () => {
    const { results, suite } = await planAll({
      files: { "a.spec.ts": ["a1", "a2"] },
      parallel: ["a.spec.ts"],
      durations: durationsFile({ "a.spec.ts › a1": 1000, "a.spec.ts › a2": 1000, "gone.spec.ts › old": 99_000 }),
      total: 2,
    });
    expect(results.map((r) => r.mode)).toEqual(["recorded", "recorded"]);
    const all = results.flatMap((r) => listed(r));
    expect(all.sort()).toEqual(collectTests(suite).map((t) => `${t.file} › ${t.titles.join(" › ")}`).sort());
    expect(all.join("\n")).not.toContain("gone");
  });

  it("falls back to --shard without history", async () => {
    for (const durations of [undefined, "{not json", { version: 2, tests: [] }, { version: 1, tests: [{ file: "a.spec.ts" }] }]) {
      const { results } = await planAll({ files: { "a.spec.ts": ["a1", "a2"] }, durations, total: 2 });
      expect(results.map((r) => r.arg)).toEqual(["--shard=1/2", "--shard=2/2"]);
      expect(results.every((r) => r.mode === "fallback")).toBe(true);
    }
  });

  it("falls back to --shard when no listed test has history", async () => {
    const { results } = await planAll({
      files: { "a.spec.ts": ["a1", "a2"] },
      durations: durationsFile({ "other.spec.ts › x": 1000 }),
      total: 2,
    });
    expect(results.map((r) => r.arg)).toEqual(["--shard=1/2", "--shard=2/2"]);
    expect(results[0]!.reason).toContain("no listed test has a recorded duration");
  });

  it("falls back to --shard when the lists do not add up to the suite", async () => {
    const durations = durationsFile({ "a.spec.ts › a1": 3000, "a.spec.ts › a2": 2000, "a.spec.ts › a3": 1000 });
    const files = { "a.spec.ts": ["a1", "a2", "a3"] };
    // A list that resolves to fewer tests than written (a test dropped).
    const dropped = await planAll({
      files, parallel: ["a.spec.ts"], durations, total: 2,
      resolve: (report, text, list) => resolveList(report, list.endsWith("shard-1-of-2.txt") ? text.split("\n").slice(1).join("\n") : text),
    });
    expect(dropped.results.map((r) => r.arg)).toEqual(["--shard=1/2", "--shard=2/2"]);
    expect(dropped.results[0]!.reason).toMatch(/1 missing/);
    // A list that resolves to more tests than written (a test in two shards).
    const doubled = await planAll({
      files, parallel: ["a.spec.ts"], durations, total: 2,
      resolve: (report) => report,
    });
    expect(doubled.results.map((r) => r.arg)).toEqual(["--shard=1/2", "--shard=2/2"]);
    expect(doubled.results[0]!.reason).toMatch(/3 in more than one list/);
  });

  it("falls back to --shard when the listing fails or a title cannot go in a list", async () => {
    const durations = durationsFile({ "a.spec.ts › a1": 1000 });
    const failed = await planAll({ files: { "a.spec.ts": ["a1"] }, durations, total: 2, listError: true });
    expect(failed.results.map((r) => r.arg)).toEqual(["--shard=1/2", "--shard=2/2"]);
    const odd = await planAll({
      files: { "a.spec.ts": ["a1", "a2"] },
      durations, total: 2,
      edit: (suite) => { (suite.suites![0]!.specs![1] as { title: string }).title = "x \u203a y"; },
    });
    expect(odd.results.map((r) => r.mode)).toEqual(["fallback", "fallback"]);
  });

  it("writes the line Playwright reads for a test in a describe", () => {
    const [test] = collectTests(listing({ "a.spec.ts": ["group › case"] }));
    expect(testListLine(test!)).toBe("[chromium] › a.spec.ts › group › case");
    expect(() => testListLine({ ...test!, titles: ["case "] })).toThrow();
    expect(() => testListLine({ ...test!, titles: ["a \u203a b"] })).toThrow();
  });

  it("recognizes a file in parallel mode only at the top level", () => {
    expect(isParallelFile(`import { test } from "x";\n${PARALLEL}`)).toBe(true);
    expect(isParallelFile("test.describe.configure({ timeout: 1 });\n")).toBe(false);
    expect(isParallelFile('test.describe("g", () => {\n  test.describe.configure({ mode: "parallel" });\n});\n')).toBe(false);
  });

  it("packs deterministically", () => {
    const tests = collectTests(listing({ "a.spec.ts": ["a", "b", "c", "d"] }));
    const durations = new Map(tests.map((test) => [test.key, 1000]));
    const first = packShards({ tests, durations, total: 3, parallelFiles: new Set(["a.spec.ts"]) });
    const second = packShards({ tests: [...tests].reverse(), durations, total: 3, parallelFiles: new Set(["a.spec.ts"]) });
    expect(first.shards.map((s) => s.map((t) => t.key).sort())).toEqual(second.shards.map((s) => s.map((t) => t.key).sort()));
  });

  it("records the duration of the last attempt", () => {
    const report = listing({ "a.spec.ts": ["a1", "a2"] });
    const [first, second] = (report.suites![0]!.specs as any[]);
    first.tests[0].results = [{ duration: 30_000, status: "failed" }, { duration: 1200, status: "passed" }];
    second.tests[0].results = [];
    expect(durationsFromReport(report)).toEqual({
      version: 1,
      tests: [{ project: "chromium", file: "a.spec.ts", titles: ["a1"], duration: 1200 }],
    });
    expect(readDurations(durationsFromReport(report)).get(testKey("chromium", "a.spec.ts", ["a1"]))).toBe(1200);
  });

  it("checks that the merged report holds every listed test once", () => {
    const list = listing({ "a.spec.ts": ["a1", "a2"] });
    expect(checkReport(list, list).ok).toBe(true);
    const short = checkReport(list, listing({ "a.spec.ts": ["a1"] }));
    expect(short.missing).toHaveLength(1);
    const twice = listing({ "a.spec.ts": ["a1", "a2"] });
    twice.suites!.push(listing({ "a.spec.ts": ["a2"] }).suites![0]!);
    expect(checkReport(list, twice).duplicated).toEqual([testKey("chromium", "a.spec.ts", ["a2"])]);
    expect(checkPartition(collectTests(list), [collectTests(listing({ "b.spec.ts": ["x"] }))]).unexpected).toHaveLength(1);
  });
});
