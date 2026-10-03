import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { SmokeRoute } from "../fixtures/routes";

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
 * When optionalArtifact is set, a missing-artifact region + retry CTA is OK.
 */
export async function expectBoardDirectReady(
  page: Page,
  options: { optionalArtifact?: boolean } = {},
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
  await expect(page.getByTestId("game-retry")).toBeVisible();
}

export async function expectPrivacyReady(page: Page): Promise<void> {
  await expectShellVisible(page);
  await expect(page.getByTestId("privacy-content")).toBeVisible();
}

/** Run the boot contract for a smoke route after navigation. */
export async function bootRoute(page: Page, route: SmokeRoute): Promise<void> {
  switch (route.kind) {
    case "quiz-setup":
      await expectQuizSetupReady(page);
      await page.getByTestId("game-start").click();
      await expectQuizBoardVisible(page);
      break;
    case "board-direct":
      await expectBoardDirectReady(
        page,
        route.optionalArtifact ? { optionalArtifact: true } : {},
      );
      break;
    case "privacy":
      await expectPrivacyReady(page);
      break;
  }
}
