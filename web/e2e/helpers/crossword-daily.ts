import type { BrowserContext, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dailyReferenceDate } from "../../src/data/daily-artifact";
import { buildCrosswordDaily } from "../../src/test/crossword-daily-fixture";

/**
 * The audited pilot board. The build publishes no daily crossword of its
 * own, so the specs play this board as today's crossword-daily-v1 envelope.
 */
export const pilotBoard = JSON.parse(readFileSync(new URL("../../public/data/crossword-pilot.json", import.meta.url), "utf8"));

/** Today's envelope (America/Sao_Paulo) around board, sealed with its checksum. */
export function crosswordDaily(board = pilotBoard): Promise<Record<string, unknown>> {
  return buildCrosswordDaily(board, dailyReferenceDate());
}

/** Serves board as today's data/crossword.daily.json; data/next/ answers 404. */
export async function routeCrosswordDaily(target: Page | BrowserContext, board = pilotBoard): Promise<void> {
  const daily = await crosswordDaily(board);
  await target.route("**/data/next/crossword.daily.json", (route) => route.fulfill({ status: 404, body: "" }));
  await target.route("**/data/crossword.daily.json", (route) => route.fulfill({ json: daily }));
}
