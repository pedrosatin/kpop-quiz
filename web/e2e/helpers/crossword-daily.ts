import type { BrowserContext, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildCrosswordDaily } from "../../src/test/crossword-daily-fixture";
import { FIXED_DATA_DIR, fixedDailyInstant } from "./fixed-daily";
import { hasGuardClock, installGuardClock } from "./guard-clock";
import { FIRST_DAILY_DATE } from "../../src/lib/daily-challenge";
import { join } from "node:path";

/**
 * Crossword's own frozen day: the first published crossword date, so share
 * text carries #1 and loadCrosswordPuzzle accepts the sealed envelope when
 * the page clock is pinned here. Other games keep FIXED_REFERENCE_DATE.
 */
export const FIXED_CROSSWORD_DATE = FIRST_DAILY_DATE.crossword;

/**
 * The audited pilot board, frozen under e2e/fixtures/fixed-data. Behaviour
 * specs seal it for FIXED_CROSSWORD_DATE; route smoke still proves the live day.
 */
export const pilotBoard = JSON.parse(
  readFileSync(join(FIXED_DATA_DIR, "crossword-pilot.json"), "utf8"),
);

/** Fixed-day envelope around board, sealed with its checksum. */
export function crosswordDaily(board = pilotBoard): Promise<Record<string, unknown>> {
  return buildCrosswordDaily(board, FIXED_CROSSWORD_DATE);
}

function isPage(target: Page | BrowserContext): target is Page {
  // Pages navigate; contexts spawn pages. Do not use `.clock` — both may expose it.
  return typeof (target as Page).goto === "function";
}

/**
 * Pins the page clock to FIXED_CROSSWORD_DATE so loadCrosswordPuzzle accepts
 * the sealed envelope (reference_date must equal "today"). Call after
 * newPage when the routes were installed on a BrowserContext.
 */
export async function freezeCrosswordClock(page: Page, { guardClock = true }: { guardClock?: boolean } = {}): Promise<void> {
  if (hasGuardClock(page)) return;
  const instant = fixedDailyInstant(FIXED_CROSSWORD_DATE);
  if (guardClock) await installGuardClock(page, instant);
  else await page.clock.setFixedTime(instant);
}

/**
 * Serves board as the fixed day's data/crossword.daily.json. data/next/ and
 * that day's publication records answer 404 so a published-ahead day in the
 * dist cannot turn a missing-envelope scenario into "played without board".
 * When `target` is a Page, also freezes its clock to the sealed day.
 */
export async function routeCrosswordDaily(target: Page | BrowserContext, board = pilotBoard): Promise<void> {
  const daily = await crosswordDaily(board);
  const day = FIXED_CROSSWORD_DATE;
  if (isPage(target)) await freezeCrosswordClock(target);
  await target.route("**/data/next/crossword.daily.json", (route) => route.fulfill({ status: 404, body: "" }));
  await target.route(`**/data/crossword-publication.${day}.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await target.route(`**/data/next/crossword-publication.${day}.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await target.route("**/data/crossword.daily.json", (route) => route.fulfill({ json: daily }));
}
