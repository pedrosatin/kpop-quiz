// Child process for run-lock.test.ts. Takes the lock `rounds` times and checks,
// inside the critical section, that no live process is in it at the same time.
// Usage: node run-lock-child.mjs <lock module> <dir> <rounds> <hold ms> <poll ms> [hang]
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, dir, rounds, holdMs, pollMs, mode] = process.argv.slice(2);
const { withRunLock } = await import(pathToFileURL(modulePath).href);
const inside = join(dir, "inside");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function enter() {
  for (;;) {
    try {
      await writeFile(inside, String(process.pid), { flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const other = Number(await readFile(inside, "utf8").catch(() => "0"));
      if (other > 0 && alive(other)) {
        await appendFile(join(dir, "overlaps"), `${process.pid} entered while ${other} was inside\n`);
        return;
      }
      await unlink(inside).catch(() => {}); // Left by a holder the test killed.
    }
  }
}

for (let i = 0; i < Number(rounds); i++) {
  await withRunLock(dir, async () => {
    await enter();
    if (mode === "hang") {
      process.stdout.write("HOLDING\n");
      setInterval(() => {}, 1_000); // Keeps the process alive.
      await new Promise(() => {}); // The test kills this process here.
    }
    await sleep(Number(holdMs));
    await appendFile(join(dir, "entries"), `${process.pid}\n`);
    if (Number(await readFile(inside, "utf8").catch(() => "0")) === process.pid) await unlink(inside);
  }, Number(pollMs));
}
