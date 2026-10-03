import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Waits for Preact hydration into the quiz setup state. */
export async function expectQuizSetupReady(page: Page): Promise<void> {
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.getByTestId("game-setup")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-start")).toBeVisible();
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
}

export async function expectQuizBoardVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 15_000 });
}
