import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { loadPreferNextDaily } from "./helpers/daily-artifact";
import { joinBaseUrl } from "../src/lib/join-base-url";

interface NameGuessDaily {
  reference_date: string;
  word_length: number;
  target: { normalized_name: string };
  valid_guesses: string[];
}

const ACCENTED: Record<string, string> = { A: "Á", C: "Ç", E: "È", I: "Í", N: "Ñ", O: "Ö", U: "Ü" };

const locales = [
  {
    id: "pt",
    path: "/pt-br/adivinhe/",
    row: (n: number) => `Palpite ${n}`,
    tile: (pos: number, letter: string) => `Posição ${pos}: letra ${letter}`,
    empty: (pos: number) => `Posição ${pos}: vazia`,
    full: (length: number) => `O nome de hoje tem ${length} letras.`,
  },
  {
    id: "en",
    path: "/en/guess/",
    row: (n: number) => `Guess ${n}`,
    tile: (pos: number, letter: string) => `Position ${pos}: letter ${letter}`,
    empty: (pos: number) => `Position ${pos}: empty`,
    full: (length: number) => `Today's name has ${length} letters.`,
  },
];

/** A valid wrong guess with at least one letter that has an accented form. */
async function pickGuess(page: Page, baseURL: string): Promise<{ guess: string; length: number }> {
  const puzzle = await loadPreferNextDaily<NameGuessDaily>(page.request, baseURL, "name-guess.daily.json");
  const guess = puzzle.valid_guesses.find(
    (word) => word !== puzzle.target.normalized_name
      && word.length === puzzle.word_length
      && [...word].some((letter) => letter in ACCENTED),
  );
  expect(guess, "need a wrong valid guess with an accentable letter").toBeTruthy();
  return { guess: guess!, length: puzzle.word_length };
}

/**
 * Types a letter as a keyboard with dead keys does: a "Dead" keydown, then a
 * keydown whose key is the accented letter. Playwright's keyboard only knows
 * the US layout, so this goes through the browser's input pipeline (CDP).
 */
async function typeAccented(page: Page, accented: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Dead", code: "Quote", windowsVirtualKeyCode: 222 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Dead", code: "Quote", windowsVirtualKeyCode: 222 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: accented, text: accented, unmodifiedText: accented });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: accented });
  await cdp.detach();
}

test.describe("name guess keyboard input", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "accented keys are sent through CDP");

  for (const locale of locales) {
    test(`${locale.id}: accented keys type the base letter, a full row says its length, Enter submits`, async ({ page, baseURL }) => {
      const { guess, length } = await pickGuess(page, baseURL!);
      await page.goto(joinBaseUrl(baseURL!, locale.path));
      await expectBoardDirectReady(page);

      for (const letter of guess) {
        if (ACCENTED[letter]) await typeAccented(page, ACCENTED[letter]!);
        else await page.keyboard.press(letter.toLowerCase());
      }

      const board = page.getByTestId("game-board");
      const row1 = board.getByRole("group", { name: locale.row(1), exact: true });
      for (let i = 0; i < guess.length; i += 1) {
        await expect(row1.getByRole("img").nth(i)).toHaveAttribute("aria-label", locale.tile(i + 1, guess[i]!));
      }

      const live = board.locator(".game-actions-message");
      await expect(live).toBeEmpty();
      await typeAccented(page, "È");
      await expect(live).toHaveText(locale.full(length));
      await expect(row1.getByRole("img").last()).toHaveAttribute("aria-label", locale.tile(length, guess.at(-1)!));

      await page.keyboard.press("Enter");
      await expect(row1.getByRole("img").first()).not.toHaveAttribute("data-status", "active");
      await expect(board.getByRole("group", { name: locale.row(2), exact: true }).getByRole("img").first())
        .toHaveAttribute("aria-label", locale.empty(1));
    });

    test(`${locale.id}: Enter on a focused letter key submits, Space types the letter once`, async ({ page, baseURL }) => {
      const { guess } = await pickGuess(page, baseURL!);
      await page.goto(joinBaseUrl(baseURL!, locale.path));
      await expectBoardDirectReady(page);

      for (const letter of guess.slice(0, -1)) await page.keyboard.press(letter.toLowerCase());
      const board = page.getByTestId("game-board");
      const lastKey = board.locator(`[data-key="${guess.at(-1)}"]`);
      await lastKey.focus();
      await page.keyboard.press("Space");

      const row1 = board.getByRole("group", { name: locale.row(1), exact: true });
      await expect(row1.getByRole("img").last()).toHaveAttribute("aria-label", locale.tile(guess.length, guess.at(-1)!));
      await expect(row1.getByRole("img").first()).toHaveAttribute("data-status", "active");

      await page.keyboard.press("Enter");
      await expect(row1.getByRole("img").first()).not.toHaveAttribute("data-status", "active");
      // The focused key's letter was not typed again into the next row.
      const row2 = board.getByRole("group", { name: locale.row(2), exact: true });
      await expect(row2.getByRole("img").first()).toHaveAttribute("aria-label", locale.empty(1));
      await expect(board.locator(".game-actions-message")).toBeEmpty();
    });
  }
});
