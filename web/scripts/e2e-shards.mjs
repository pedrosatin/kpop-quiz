#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DELIMITER = " › ";
const PARALLEL_MODE = /^test\.describe\.configure\(\{[^}]*\bmode:\s*["']parallel["']/m;
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} project @param {string} file @param {string[]} titles */
export function testKey(project, file, titles) {
  return JSON.stringify([project, file, ...titles]);
}

function walk(report) {
  const found = [];
  const visit = (suite, file, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const result of spec.tests ?? []) {
        const project = result.projectName ?? "";
        const specTitles = [...titles, spec.title];
        found.push({
          test: {
            key: testKey(project, file, specTitles),
            project,
            file,
            titles: specTitles,
            line: spec.line ?? 0,
            column: spec.column ?? 0,
          },
          result,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, file, [...titles, child.title ?? ""]);
  };
  for (const suite of report.suites ?? []) visit(suite, suite.file ?? suite.title ?? "", []);
  return found;
}

/** @param {JsonReport} report @returns {ListedTest[]} */
export function collectTests(report) {
  return walk(report).map(({ test }) => test);
}

/**
 * Durations of a run's report, in milliseconds: the last attempt of each test,
 * the one that decided its outcome.
 * @param {JsonReport} report
 * @returns {DurationsFile}
 */
export function durationsFromReport(report) {
  const tests = [];
  for (const { test, result } of walk(report)) {
    const last = result.results?.at(-1);
    if (!last || typeof last.duration !== "number") continue;
    tests.push({ project: test.project, file: test.file, titles: test.titles, duration: last.duration });
  }
  return { version: 1, tests };
}

/**
 * The durations file as a map from test key to milliseconds. Throws on any
 * other shape, so a broken file means "no history", never a partial split.
 * @param {unknown} data
 * @returns {Map<string, number>}
 */
export function readDurations(data) {
  const file =  (data);
  if (!file || file.version !== 1 || !Array.isArray(file.tests)) {
    throw new Error("not a version 1 durations file");
  }
  const durations = new Map();
  for (const entry of file.tests) {
    const ok = entry && typeof entry.project === "string" && typeof entry.file === "string"
      && Array.isArray(entry.titles) && entry.titles.every((title) => typeof title === "string")
      && typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration >= 0;
    if (!ok) throw new Error(`malformed durations entry: ${JSON.stringify(entry)}`);
    durations.set(testKey(entry.project, entry.file, entry.titles), entry.duration);
  }
  return durations;
}

/** Whether a spec file opts all its tests into parallel mode at the top level. */
export function isParallelFile( source) {
  return PARALLEL_MODE.test(source);
}

/**
 * The `--test-list` line of a test. Throws when a title would not survive
 * Playwright's parsing of the line (it splits on the delimiter and trims).
 * @param {ListedTest} test
 */
export function testListLine(test) {
  const tokens = [test.file, ...test.titles];
  for (const token of tokens) {
    if (token.includes("›") || token !== token.trim() || token === "") {
      throw new Error(`test title cannot go in a test list: ${JSON.stringify(token)}`);
    }
  }
  if (test.project.includes("]")) throw new Error(`project cannot go in a test list: ${test.project}`);
  return [`[${test.project}]`, ...tokens].join(DELIMITER);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Greedy split by recorded time.
 * @param {{ tests: ListedTest[], durations: Map<string, number>, total: number, parallelFiles: Set<string> }} input
 * @returns {{ shards: ListedTest[][], loads: number[], known: number, unknown: number }}
 */
export function packShards({ tests, durations, total, parallelFiles }) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`invalid shard total: ${total}`);
  const known = tests.filter((test) => durations.has(test.key));
  const estimate = median(known.map((test) => durations.get(test.key) ?? 0)) || 1;

  const units = new Map();
  for (const test of tests) {
    const id = parallelFiles.has(test.file) ? test.key : JSON.stringify(["file", test.file]);
    const unit = units.get(id) ?? [];
    unit.push(test);
    units.set(id, unit);
  }
  const weighed = [...units.entries()].map(([id, members]) => ({
    id,
    members,
    known: members.some((test) => durations.has(test.key)),
    weight: members.reduce((sum, test) => sum + (durations.get(test.key) ?? estimate), 0),
  }));
  weighed.sort((a, b) => Number(b.known) - Number(a.known) || b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const shards = Array.from({ length: total }, () =>  ([]));
  const loads = Array.from({ length: total }, () => 0);
  for (const unit of weighed) {
    const lightest = loads.indexOf(Math.min(...loads));
    shards[lightest]?.push(...unit.members);
    loads[lightest] = (loads[lightest] ?? 0) + unit.weight;
  }
  const order = new Map(tests.map((test, index) => [test.key, index]));
  for (const shard of shards) shard.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  return { shards, loads, known: known.length, unknown: tests.length - known.length };
}

/**
 * Whether the tests each list resolved to add up to the suite: every test in
 * exactly one list and nothing outside the suite.
 * @param {ListedTest[]} suite
 * @param {ListedTest[][]} resolved
 */
export function checkPartition(suite, resolved) {
  const expected = new Set(suite.map((test) => test.key));
  const seen = new Map();
  for (const list of resolved) for (const test of list) seen.set(test.key, (seen.get(test.key) ?? 0) + 1);
  const missing = [...expected].filter((key) => !seen.has(key));
  const duplicated = [...seen].filter(([key, count]) => count > 1 && expected.has(key)).map(([key]) => key);
  const unexpected = [...seen.keys()].filter((key) => !expected.has(key));
  return { ok: missing.length + duplicated.length + unexpected.length === 0, missing, duplicated, unexpected };
}

/**
 * The Playwright argument for one shard, and why.
 * @param {PlanOptions} options
 * @returns {Promise<{ arg: string, mode: "recorded" | "fallback", reason: string, lists?: string[] }>}
 */
export async function plan({ shard, total, durationsPath, outDir, listTests, readSource, log = () => {} }) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(shard) || shard < 1 || shard > total) {
    throw new Error(`invalid shard ${shard}/${total}`);
  }
  const fallback = ( reason) => {
    log(`fallback to --shard=${shard}/${total}: ${reason}`);
    return { arg: `--shard=${shard}/${total}`, mode:  ("fallback"), reason };
  };

  let durations;
  try {
    durations = readDurations(JSON.parse(await readFile(durationsPath, "utf8")));
  } catch (error) {
    return fallback(`no usable recorded durations (${error instanceof Error ? error.message : error})`);
  }

  let suite;
  let rootDir;
  try {
    const report = await listTests();
    if (report.errors?.length) return fallback(`the test listing reported ${report.errors.length} error(s)`);
    suite = collectTests(report);
    rootDir = report.config?.rootDir;
  } catch (error) {
    return fallback(`the test listing failed (${error instanceof Error ? error.message : error})`);
  }
  if (suite.length === 0) return fallback("the listing found no tests");
  if (!suite.some((test) => durations.has(test.key))) return fallback("no listed test has a recorded duration");

  const parallelFiles = new Set();
  for (const file of new Set(suite.map((test) => test.file))) {
    try {
      if (isParallelFile(await readSource(rootDir ? join(rootDir, file) : file))) parallelFiles.add(file);
    } catch (error) {
      return fallback(`cannot read ${file} (${error instanceof Error ? error.message : error})`);
    }
  }

  const packed = packShards({ tests: suite, durations, total, parallelFiles });
  await mkdir(outDir, { recursive: true });
  const lists = packed.shards.map((_tests, index) => resolve(outDir, `shard-${index + 1}-of-${total}.txt`));
  try {
    await Promise.all(packed.shards.map((tests, index) =>
      writeFile(lists[index] ?? "", tests.map((test) => `${testListLine(test)}\n`).join(""))));
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error));
  }

  let resolved;
  try {
    resolved = await Promise.all(lists.map(async (list) => collectTests(await listTests(list))));
  } catch (error) {
    return fallback(`resolving the lists failed (${error instanceof Error ? error.message : error})`);
  }
  const check = checkPartition(suite, resolved);
  if (!check.ok) {
    return fallback(`the lists do not add up to the suite: ${check.missing.length} missing, `
      + `${check.duplicated.length} in more than one list, ${check.unexpected.length} outside the suite`);
  }

  const seconds = packed.loads.map((load) => Math.round(load / 1000));
  log(`recorded split of ${suite.length} tests (${packed.known} with history, ${packed.unknown} without) `
    + `into ${total} shards; estimated serial seconds per shard: ${seconds.join(", ")}`);
  log(`shard ${shard}/${total}: ${resolved[shard - 1]?.length ?? 0} tests`);
  return { arg: `--test-list=${lists[shard - 1]}`, mode: "recorded", reason: "recorded durations", lists };
}

/**
 * Compares the merged report with the listing: every listed test once.
 * @param {JsonReport} list
 * @param {JsonReport} report
 */
export function checkReport(list, report) {
  const reported = walk(report);
  const check = checkPartition(collectTests(list), [reported.map(({ test }) => test)]);
  const outcomes = {};
  for (const { result } of reported) {
    const outcome = result.status ?? "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { ...check, total: reported.length, outcomes };
}

/**
 * `playwright test --list` as JSON, for the chromium project, in this web/ checkout.
 * @param {string} [testList]
 * @returns {Promise<JsonReport>}
 */
export function playwrightList(testList) {
  const args = ["test", "--list", "--project=chromium", "--reporter=json"];
  if (testList) args.push(`--test-list=${testList}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(join(webRoot, "node_modules", ".bin", "playwright"), args, {
      cwd: webRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`playwright ${args.join(" ")} exited with ${code}: ${stderr.trim().slice(-500)}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function options(argv) {
  const found = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`expected --name value pairs, got ${argv.join(" ")}`);
    found[name.slice(2)] = value;
  }
  return found;
}

function required(found, name) {
  const value = found[name];
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** @param {string[]} argv */
export async function main(argv) {
  const [command, ...rest] = argv;
  const found = options(rest);
  const log = ( line) => process.stderr.write(`${line}\n`);
  if (command === "plan") {
    const result = await plan({
      shard: Number(required(found, "shard")),
      total: Number(required(found, "total")),
      durationsPath: required(found, "durations"),
      outDir: required(found, "out"),
      listTests: playwrightList,
      readSource: (file) => readFile(file, "utf8"),
      log,
    });
    if (result.mode === "fallback") log(`::warning::E2E shards fall back to Playwright's --shard: ${result.reason}`);
    process.stdout.write(`${result.arg}\n`);
    return 0;
  }
  if (command === "check") {
    const result = checkReport(await readJson(required(found, "list")), await readJson(required(found, "report")));
    const outcomes = Object.entries(result.outcomes).map(([name, count]) => `${name} ${count}`).join(", ");
    log(`merged report: ${result.total} tests (${outcomes})`);
    if (!result.ok) {
      for (const key of result.missing.slice(0, 20)) log(`missing: ${key}`);
      for (const key of result.duplicated.slice(0, 20)) log(`in more than one shard: ${key}`);
      for (const key of result.unexpected.slice(0, 20)) log(`not in the listing: ${key}`);
      log(`::error::The shards did not run the whole suite once: ${result.missing.length} missing, `
        + `${result.duplicated.length} duplicated, ${result.unexpected.length} unexpected.`);
      return 1;
    }
    return 0;
  }
  if (command === "durations") {
    const durations = durationsFromReport(await readJson(required(found, "report")));
    const out = required(found, "out");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(durations)}\n`);
    log(`recorded durations of ${durations.tests.length} tests in ${out}`);
    return 0;
  }
  throw new Error(`unknown command ${command ?? "(none)"}; expected plan, check or durations`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
