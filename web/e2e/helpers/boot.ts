import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { DailyArtifact, SmokeRoute } from "../fixtures/routes";
import { isPublished } from "./published";

const SETUP_TIMEOUT_MS = 30_000;
const BOARD_TIMEOUT_MS = 30_000;

export async function expectShellVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("game-shell")).toBeVisible();
}

/** Quiz home: shell + GameSetup ready (Start enabled). */
export async function expectQuizSetupReady(page: Page): Promise<void> {
  await expectShellVisible(page);
  await expect(page.getByTestId("game-setup")).toBeVisible({ timeout: SETUP_TIMEOUT_MS });
  await expect(page.getByTestId("game-start")).toBeVisible();
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: SETUP_TIMEOUT_MS });
}

export async function expectQuizBoardVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: BOARD_TIMEOUT_MS });
}

/**
 * Daily games that mount the board without a Start click.
 * When optionalArtifact is set, a missing-artifact region + retry CTA is OK;
 * missingKinds further restricts which data-error-kind that region may carry.
 */
export async function expectBoardDirectReady(
  page: Page,
  options: { optionalArtifact?: boolean; missingKinds?: readonly string[] } = {},
): Promise<void> {
  await expectShellVisible(page);
  const board = page.getByTestId("game-board");
  if (!options.optionalArtifact) {
    await expect(board).toBeVisible({ timeout: BOARD_TIMEOUT_MS });
    return;
  }

  const missing = page.getByTestId("game-missing");
  await expect(board.or(missing)).toBeVisible({ timeout: BOARD_TIMEOUT_MS });

  // Prefer board with a waiting expect; avoid one-shot isVisible during transitions.
  try {
    await expect(board).toBeVisible({ timeout: 2_000 });
    return;
  } catch {
    // Missing-artifact path.
  }

  await expect(missing).toBeVisible();
  if (options.missingKinds) {
    const kind = await missing.getAttribute("data-error-kind");
    expect(options.missingKinds, `unexpected missing state "${kind}"`).toContain(kind);
  }
  await expect(page.getByTestId("game-retry")).toBeVisible();
}

export async function expectPrivacyReady(page: Page): Promise<void> {
  await expectShellVisible(page);
  await expect(page.getByTestId("privacy-content")).toBeVisible();
}

/**
 * The page of a daily file the day may omit: the board when the file is
 * published, the missing state otherwise. An "invalid" state always fails.
 */
async function expectDailyArtifactState(
  page: Page,
  artifact: DailyArtifact,
  baseURL: string,
): Promise<void> {
  const board = page.getByTestId("game-board");
  if (await isPublished(page.request, baseURL, artifact.file)) {
    await expect(board).toBeVisible({ timeout: BOARD_TIMEOUT_MS });
    return;
  }
  const missing = page.getByTestId("game-missing");
  if (artifact.fallback) {
    await expect(board.or(missing)).toBeVisible({ timeout: BOARD_TIMEOUT_MS });
    if (await board.isVisible()) return;
  }
  await expect(missing).toBeVisible({ timeout: BOARD_TIMEOUT_MS });
  await expect(missing).toHaveAttribute("data-error-kind", "missing");
  await expect(page.getByTestId("game-retry")).toBeVisible();
}

/** The quiz home: Start opens the board, or the missing state of a day without the quiz. */
async function bootQuizSetup(page: Page, artifact: DailyArtifact | undefined, baseURL: string | undefined): Promise<void> {
  if (artifact && baseURL && !(await isPublished(page.request, baseURL, artifact.file))) {
    // Without its manifest the daily quiz opens on the missing state; a
    // general round from the catalog still shows the setup first.
    await expectShellVisible(page);
    const setup = page.getByTestId("game-setup");
    await expect(setup.or(page.getByTestId("game-missing"))).toBeVisible({ timeout: SETUP_TIMEOUT_MS });
    if (await setup.isVisible()) await page.getByTestId("game-start").click();
    await expectDailyArtifactState(page, artifact, baseURL);
    return;
  }
  await expectQuizSetupReady(page);
  await page.getByTestId("game-start").click();
  await expectQuizBoardVisible(page);
}

/** A game that mounts its board without a Start click. */
async function bootBoardDirect(
  page: Page,
  route: Extract<SmokeRoute, { kind: "board-direct" }>,
  baseURL: string | undefined,
): Promise<void> {
  if (route.artifact && baseURL) {
    await expectShellVisible(page);
    await expectDailyArtifactState(page, route.artifact, baseURL);
    return;
  }
  await expectBoardDirectReady(page, {
    ...(route.optionalArtifact ? { optionalArtifact: true } : {}),
    ...(route.missingKinds ? { missingKinds: route.missingKinds } : {}),
  });
}

/**
 * Run the boot contract for a smoke route after navigation. A route with an
 * artifact needs `baseURL` to learn whether the day published it; without
 * one, the board is required.
 */
export async function bootRoute(page: Page, route: SmokeRoute, baseURL?: string): Promise<void> {
  switch (route.kind) {
    case "quiz-setup":
      await bootQuizSetup(page, route.artifact, baseURL);
      break;
    case "board-direct":
      await bootBoardDirect(page, route, baseURL);
      break;
    case "privacy":
      await expectPrivacyReady(page);
      break;
  }
}
