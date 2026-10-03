import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";
import { loadPreferNextDaily } from "../helpers/daily-artifact";

const NAME_GUESS_PATH = "/pt-br/adivinhe/";

interface NameGuessDaily {
  reference_date: string;
  max_attempts: number;
  word_length: number;
  target: { normalized_name: string };
  valid_guesses: string[];
}

export class NameGuessPage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  async open(): Promise<void> {
    const url = joinBaseUrl(this.baseURL, NAME_GUESS_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  /** Exhaust max_attempts with distinct wrong entries from valid_guesses. */
  async loseWithWrongGuesses(): Promise<void> {
    const puzzle = await loadPreferNextDaily<NameGuessDaily>(
      this.page.request,
      this.baseURL,
      "name-guess.daily.json",
    );
    const answer = puzzle.target.normalized_name;
    const wrongs = puzzle.valid_guesses
      .filter((guess) => guess !== answer && guess.length === puzzle.word_length)
      .slice(0, puzzle.max_attempts);
    expect(
      wrongs.length,
      `need ${puzzle.max_attempts} wrong valid guesses`,
    ).toBe(puzzle.max_attempts);

    const board = this.page.getByTestId("game-board");
    for (let i = 0; i < wrongs.length; i += 1) {
      const guess = wrongs[i]!;
      for (const char of guess) {
        await board.locator(`[data-key="${char}"]`).click();
      }
      await board.locator('[data-key="ENTER"]').click();
      // Submitted rows keep their letters; wait for this attempt to land.
      await expect(
        board.getByRole("group", { name: `Palpite ${i + 1}` }).getByRole("img").first(),
      ).not.toHaveAttribute("aria-label", "Posição 1: vazia");
    }

    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
