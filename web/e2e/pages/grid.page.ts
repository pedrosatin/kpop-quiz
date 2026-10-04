import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { CELL_GUARD_MS } from "../../src/components/Grid/next-cell-after-guess";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";

const GRID_PATH = "/pt-br/grid/";
/** Buffer past CELL_GUARD_MS so the next cell click is not swallowed. */
const CELL_CLICK_WAIT_MS = CELL_GUARD_MS + 50;

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

        const listbox = this.page.getByRole("listbox");
        await cell.click();
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
          // Cells ignore pointer clicks for CELL_GUARD_MS after a guess, so
          // wait it out before clicking the next cell.
          await expect(listbox).toBeHidden();
          await this.page.waitForTimeout(CELL_CLICK_WAIT_MS);
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
