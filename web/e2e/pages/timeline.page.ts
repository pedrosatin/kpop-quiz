import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";

const TIMELINE_PATH = "/pt-br/linha-do-tempo/";

export class TimelinePage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  async open(): Promise<void> {
    const url = joinBaseUrl(this.baseURL, TIMELINE_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  /** Submit the default board order (no drag). */
  async submitDefaultOrder(): Promise<void> {
    const board = this.page.getByTestId("game-board");
    const submit = board.getByRole("button", { name: "Verificar ordem" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
