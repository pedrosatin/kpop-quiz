import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";

const GRID_PATH = "/pt-br/grid/";

export class GridPage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  async open(): Promise<void> {
    const url = joinBaseUrl(this.baseURL, GRID_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page, { optionalArtifact: true });
  }

  /**
   * Missing artifact: assert missing+retry and pass.
   * Present: open each of 9 cells and pick a distinct unused candidate.
   */
  async playOrAssertMissing(): Promise<"missing" | "result"> {
    const missing = this.page.getByTestId("game-missing");
    const board = this.page.getByTestId("game-board");

    try {
      await expect(board).toBeVisible({ timeout: 2_000 });
    } catch {
      await expect(missing).toBeVisible();
      await expect(this.page.getByTestId("game-retry")).toBeVisible();
      return "missing";
    }

    const usedNames = new Set<string>();
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const cell = board.locator(`.grid-cell-btn[data-row="${row}"][data-col="${col}"]`);
        await expect(cell).toBeVisible();
        await cell.click();

        const listbox = this.page.getByRole("listbox");
        await expect(listbox).toBeVisible();
        const options = listbox.getByRole("option");
        const count = await options.count();
        let picked = false;
        for (let i = 0; i < count; i += 1) {
          const option = options.nth(i);
          if ((await option.getAttribute("aria-disabled")) === "true") continue;
          const name = ((await option.innerText()) || "").trim();
          if (!name || usedNames.has(name)) continue;
          usedNames.add(name);
          await option.click();
          picked = true;
          break;
        }
        expect(picked, `unused candidate for cell ${row},${col}`).toBeTruthy();
      }
    }

    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
    return "result";
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
