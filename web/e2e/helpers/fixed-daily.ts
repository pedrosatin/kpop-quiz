import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIntersectionGrid, type IntersectionGrid } from "../../src/lib/quiz-types";
import { isGridPublication, type GridPublication } from "../../src/data/grid-publication";
import { installGuardClock } from "./guard-clock";

/**
 * Frozen daily artifacts for behaviour E2E. Specs intercept these instead of
 * reading web/public/data for the day. Ticket 02 extends the same directory
 * and serveFixedDaily for the other games; smoke keeps the live publication.
 */
export const FIXED_DATA_DIR = fileURLToPath(new URL("../fixtures/fixed-data/", import.meta.url));

/** Identity the corrected-day scenario replaces (valid hash, distinct from the board). */
export const FIXED_REPLACED_GRID_ID =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXED_DATA_DIR, name), "utf8"));
}

const rawGrid = readJson("grid.daily.json");
if (!isIntersectionGrid(rawGrid)) {
  throw new Error("e2e/fixtures/fixed-data/grid.daily.json failed isIntersectionGrid");
}

/** Small frozen intersection grid (format validated at module load). */
export const fixedGrid: IntersectionGrid = rawGrid;

/** Sao Paulo afternoon on the board's own date, so the loader treats it as today. */
export function fixedDailyInstant(referenceDate: string = fixedGrid.reference_date): Date {
  return new Date(`${referenceDate}T18:00:00.000Z`);
}

export type FixedGridServeOptions = {
  /**
   * When true (default), install the guard clock at the fixed date so
   * crossGuard can jump cell guards. When false, freeze the page clock only.
   */
  guardClock?: boolean;
  /**
   * Non-empty list announces a corrected day (replaces notice). Omit or pass
   * [] for a normal day with no publication sidecar (legacy loader path).
   */
  replaces?: string[];
  /** Serve this board instead of the default frozen grid. */
  grid?: IntersectionGrid;
};

function publicationFor(
  grid: IntersectionGrid,
  replaces: string[],
): GridPublication {
  const publication: GridPublication = {
    schema_version: "kpop-grid-publication-v1",
    reference_date: grid.reference_date,
    grid_id: grid.grid_id,
    grid_reference_date: grid.reference_date,
    replaces,
  };
  if (!isGridPublication(publication)) {
    throw new Error("fixed-daily publication failed isGridPublication");
  }
  return publication;
}

/**
 * Pins the page clock to the frozen board's date and serves that board on the
 * grid daily routes. Only `/data/**` grid artifacts are rewritten; other
 * requests keep going to the site under test.
 *
 * Returns the board the page will load (for picking answers in the spec).
 */
export async function serveFixedGrid(
  page: Page,
  options: FixedGridServeOptions = {},
): Promise<IntersectionGrid> {
  const grid = options.grid ?? fixedGrid;
  const instant = fixedDailyInstant(grid.reference_date);
  if (options.guardClock === false) {
    await page.clock.setFixedTime(instant);
  } else {
    await installGuardClock(page, instant);
  }

  const day = grid.reference_date;
  const replaces = options.replaces;

  // next/ first so a published-ahead file in dist cannot win over the fixture.
  await page.route("**/data/next/grid.daily.json*", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route("**/data/grid.daily.json*", (route) =>
    route.fulfill({ json: grid }),
  );

  if (replaces && replaces.length > 0) {
    const publication = publicationFor(grid, replaces);
    await page.route(`**/data/next/grid-publication.${day}.json*`, (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route(`**/data/grid-publication.${day}.json*`, (route) =>
      route.fulfill({ json: publication }),
    );
  } else {
    await page.route("**/data/**/grid-publication.*", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route("**/data/grid-publication.*", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
  }

  return grid;
}

/**
 * Entry point ticket 02 will widen: today only the Grade is wired. Other
 * games keep their own helpers until that ticket migrates them.
 */
export async function serveFixedDaily(
  page: Page,
  game: "grid",
  options: FixedGridServeOptions = {},
): Promise<IntersectionGrid> {
  if (game !== "grid") {
    throw new Error(`serveFixedDaily: game "${String(game)}" is not wired yet (ticket 02)`);
  }
  return serveFixedGrid(page, options);
}
