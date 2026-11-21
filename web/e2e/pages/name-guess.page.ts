import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { NameGuessPuzzle } from "../../src/lib/quiz-types";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";
import { fixedNameGuess, serveFixedNameGuess } from "../helpers/fixed-daily";
import { aloneLabel } from "../helpers/visible-names";

const NAME_GUESS_PATH = "/pt-br/adivinhe/";

export class NameGuessPage {
  private puzzle: NameGuessPuzzle = fixedNameGuess;

  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  /**
   * Opens the frozen board. Pass `served: true` when the test already routed
   * its own artifact.
   */
  async open({ served = false }: { served?: boolean } = {}): Promise<void> {
    if (!served) this.puzzle = await serveFixedNameGuess(this.page);
    const url = joinBaseUrl(this.baseURL, NAME_GUESS_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  /** Exhaust max_attempts with distinct wrong entries from valid_guesses. */
  async loseWithWrongGuesses(): Promise<void> {
    const puzzle = this.puzzle;
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
      const guess = wrongs[i]!.toUpperCase();
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

  /**
   * The revealed answer reads exactly as the artifact publishes it: the page
   * shows one target, so no Wikipedia note is hidden, and the artifact's id
   * (the save key) is the one the page saved under.
   */
  async expectRevealedLabel(locale: "pt-BR" | "en" = "pt-BR"): Promise<void> {
    const puzzle = this.puzzle;
    await expect(this.page.locator(".name-guess-target-name")).toHaveText(aloneLabel(puzzle.target, locale));
    const savedKeys = await this.page.evaluate(() => Object.keys(localStorage));
    expect(savedKeys).toContain(`kpop_guess_state_${puzzle.puzzle_id}`);
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
