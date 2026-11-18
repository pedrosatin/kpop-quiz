// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { withRunLock } from "../e2e/fixtures/run-lock";

// The lock serializes `astro build` across Playwright workers
// (e2e/fixtures/site-builds.ts). These tests run it in real processes.
const lockModule = fileURLToPath(new URL("../e2e/fixtures/run-lock.ts", import.meta.url));
const child = fileURLToPath(new URL("./run-lock-child.mjs", import.meta.url));
const POLL_MS = 5;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "run-lock-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Child = { proc: ChildProcess; code: Promise<number | null> };

/** Listens for the exit at once: a child may finish before the test awaits it. */
function start(rounds: number, holdMs: number, mode = ""): Child {
  const proc = spawn(process.execPath, [child, lockModule, dir, String(rounds), String(holdMs), String(POLL_MS), mode], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return { proc, code: new Promise((resolve) => proc.once("exit", resolve)) };
}

/** Resolves with the exit code, or rejects if the child outlives `ms`. */
function exit({ proc, code }: Child, ms: number): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`child ${proc.pid} still waiting after ${ms} ms`));
    }, ms);
  });
  return Promise.race([code, late]).finally(() => clearTimeout(timer));
}

function holding({ proc }: Child): Promise<void> {
  return new Promise((resolve) => proc.stdout!.on("data", (data: Buffer) => {
    if (data.toString().includes("HOLDING")) resolve();
  }));
}

async function lines(name: string): Promise<string[]> {
  const text = await readFile(join(dir, name), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean);
}

test("no two processes are ever inside at once", async () => {
  const children = Array.from({ length: 6 }, () => start(4, 20));
  const codes = await Promise.all(children.map((c) => exit(c, 30_000)));
  expect(await lines("overlaps")).toEqual([]);
  expect(codes).toEqual(Array(6).fill(0));
  expect(await lines("entries")).toHaveLength(24);
}, 40_000);

test("a holder killed inside lets exactly one waiter in at a time, without a timeout", async () => {
  for (let round = 0; round < 5; round++) {
    const holder = start(1, 0, "hang");
    await holding(holder);
    const waiters = Array.from({ length: 4 }, () => start(1, 20));
    await new Promise((resolve) => setTimeout(resolve, 300)); // All of them polling.
    holder.proc.kill("SIGKILL");
    const codes = await Promise.all(waiters.map((c) => exit(c, 10_000)));
    expect(codes).toEqual([0, 0, 0, 0]);
  }
  expect(await lines("overlaps")).toEqual([]);
  expect(await lines("entries")).toHaveLength(20);
}, 90_000);

test("a ticket without a pid stops blocking after a short grace", async () => {
  const lockDir = join(dir, ".lock");
  await mkdir(lockDir);
  await writeFile(join(lockDir, "1"), "");
  const old = new Date(Date.now() - 60_000);
  await utimes(join(lockDir, "1"), old, old);
  const started = Date.now();
  expect(await withRunLock(dir, async () => "in", POLL_MS)).toBe("in");
  expect(Date.now() - started).toBeLessThan(2_000);
});
