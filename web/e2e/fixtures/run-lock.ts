import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/**
 * A mutex across the Playwright worker processes of one run, built on the file
 * system so it needs no extra dependency.
 *
 * The lock directory holds numbered tickets. Ticket `<n>` is a file whose
 * content is the pid of the process that created it; `<n>.free` marks it
 * released. The process that created the highest ticket holds the lock until
 * it writes `<n>.free` or dies. Taking the lock means creating ticket n+1 after
 * seeing ticket n free or its creator dead.
 *
 * Why no two processes ever hold it at once:
 * - A ticket is created with link() from a temporary file that already holds
 *   the pid. link() fails with EEXIST when the name exists, so each number has
 *   exactly one creator, and no ticket is ever visible without its pid.
 * - Nothing is deleted or renamed. A released or dead ticket stays so for good,
 *   so the check "n is free or dead" cannot be undone between reading it and
 *   creating n+1, and a waiter that acted on an old view only gets EEXIST.
 * - Ticket n+1 is created only after its creator saw ticket n, so numbers are
 *   contiguous and the only holder is the creator of the highest one.
 *
 * A dead holder (a worker killed mid-build) costs one poll: every waiter sees
 * it dead, one of them wins n+1 and the others go back to waiting on it.
 */
export async function withRunLock<T>(dir: string, fn: () => Promise<T>, pollMs = 200): Promise<T> {
  const lockDir = join(dir, ".lock");
  await mkdir(lockDir, { recursive: true });
  const ticket = await takeTicket(lockDir, pollMs);
  try {
    return await fn();
  } finally {
    await writeFile(join(lockDir, `${ticket}.free`), "");
  }
}

async function takeTicket(lockDir: string, pollMs: number): Promise<number> {
  for (;;) {
    const top = await highestTicket(lockDir);
    if (top === 0 || (await isFree(lockDir, top))) {
      const next = top + 1;
      if (await createTicket(lockDir, next)) return next;
      continue; // Another waiter took next; look again without sleeping.
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function highestTicket(lockDir: string): Promise<number> {
  let top = 0;
  for (const name of await readdir(lockDir)) {
    if (/^\d+$/.test(name)) top = Math.max(top, Number(name));
  }
  return top;
}

/** Publishes the ticket with the pid already in it; false if the number is taken. */
async function createTicket(lockDir: string, n: number): Promise<boolean> {
  const tmp = join(lockDir, `tmp-${process.pid}-${randomUUID()}`);
  await writeFile(tmp, String(process.pid));
  try {
    await link(tmp, join(lockDir, String(n)));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(tmp);
  }
}

/** A ticket whose content is not a pid this long after creation counts as dead. */
const UNREADABLE_TICKET_GRACE_MS = 5_000;

async function isFree(lockDir: string, n: number): Promise<boolean> {
  try {
    await stat(join(lockDir, `${n}.free`));
    return true;
  } catch {
    // Not released; free only if its holder died.
  }
  const ticket = join(lockDir, String(n));
  const pid = Number(await readFile(ticket, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) {
    // link() publishes the pid with the name, so this only happens if something
    // else wrote the file; do not let it block the run past a short grace.
    return Date.now() - (await stat(ticket)).mtimeMs > UNREADABLE_TICKET_GRACE_MS;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM means the process exists under another user.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
