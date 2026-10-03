import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";

/**
 * Mirrors MapPilotGame.NEXT_GUARD_MS. Importing MapPilotGame into Playwright
 * pulls JSON modules that Node rejects without import attributes.
 */
const NEXT_GUARD_MS = 300;

/** Buffer past Next guard so early clicks are not swallowed. */
const NEXT_CLICK_WAIT_MS = NEXT_GUARD_MS + 50;

const MAP_PATH = "/pt-br/mapa/";
const ROUND_SIZE = 10;

export class MapPage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  async open(): Promise<void> {
    const url = joinBaseUrl(this.baseURL, MAP_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  /** Pick any country × 10, waiting out the Next guard between advances. */
  async answerAllAny(): Promise<void> {
    const board = this.page.getByTestId("game-board");

    for (let i = 0; i < ROUND_SIZE; i += 1) {
      const country = board.locator("[data-testid^='answer-country-']").first();
      await expect(country).toBeEnabled();
      await country.click();

      const advance = board.getByRole("button", { name: /Próxima data|Ver resultado/ });
      await expect(advance).toBeVisible();
      await this.page.waitForTimeout(NEXT_CLICK_WAIT_MS);
      await advance.click();
    }

    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
