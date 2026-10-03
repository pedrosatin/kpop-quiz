import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";
import { loadPreferNextDaily } from "../helpers/daily-artifact";

const WORD_SEARCH_PATH = "/pt-br/caca-palavras/";

interface WordSearchWord {
  word: string;
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
}

interface WordSearchDaily {
  reference_date: string;
  words: WordSearchWord[];
}

export class WordSearchPage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  async open(): Promise<void> {
    const url = joinBaseUrl(this.baseURL, WORD_SEARCH_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  /** Complete every word via start/end coords from the active daily artifact. */
  async completeFromDailyCoords(): Promise<void> {
    const puzzle = await loadPreferNextDaily<WordSearchDaily>(
      this.page.request,
      this.baseURL,
      "word-search.daily.json",
    );
    const board = this.page.getByTestId("game-board");

    for (const word of puzzle.words) {
      const start = board.locator(
        `.word-search-cell[data-row="${word.start_row}"][data-col="${word.start_col}"]`,
      );
      const end = board.locator(
        `.word-search-cell[data-row="${word.end_row}"][data-col="${word.end_col}"]`,
      );
      await expect(start).toBeVisible();
      await expect(end).toBeVisible();

      // Two clicks: first sets the anchor, second completes the line (non-drag path).
      await start.click();
      await end.click();
      await expect(start).toHaveAttribute("data-found", "true");
    }

    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
