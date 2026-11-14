import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { NEXT_GUARD_MS } from "../../src/components/Quiz/AnswerFeedback";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectQuizBoardVisible, expectQuizSetupReady } from "../helpers/boot";
import { skipUnlessPublished } from "../helpers/published";

/** Buffer past AnswerFeedback NEXT_GUARD_MS so early clicks are not swallowed. */
const NEXT_CLICK_WAIT_MS = NEXT_GUARD_MS + 50;

const QUIZ_PATH = "/pt-br/";

/**
 * Opens "Personalizar" / "Customize" on the setup, where the mode, the timer
 * and the decades sit closed by default. Does nothing when it is already open.
 */
export async function openQuizCustomize(page: Page): Promise<void> {
  const customize = page.locator("details.setup-customize");
  if (await customize.evaluate((element) => (element as HTMLDetailsElement).open)) return;
  await customize.locator("summary").click();
  await expect(customize).toHaveAttribute("open", "");
}

export class QuizPage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  /**
   * Opens the page of the day's board. The test is skipped when the day was
   * published without data/manifest-v2.json, unless the test serves the file itself
   * (`served`).
   */
  async open({ served = false }: { served?: boolean } = {}): Promise<void> {
    if (!served) await skipUnlessPublished(this.page, this.baseURL, "manifest-v2.json");
    const url = joinBaseUrl(this.baseURL, QUIZ_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectQuizSetupReady(this.page);
  }

  async start(): Promise<void> {
    const start = this.page.getByTestId("game-start");
    await expect(start).toBeEnabled();
    await start.click();
    await expectQuizBoardVisible(this.page);
  }

  /** Pick any option, submit, wait out the Next guard, then advance. */
  async answerAnyAndAdvance(): Promise<void> {
    const board = this.page.getByTestId("game-board");
    await expect(board).toBeVisible();

    // Click the label: the radio input sits under the option-key span.
    const option = board.locator("label.option").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(board.getByRole("radio").first()).toBeChecked();

    const submit = board.getByRole("button", { name: "Responder" });
    await expect(submit).toBeEnabled();
    await submit.click();

    const advance = board.getByRole("button", { name: /Próxima pergunta|Ver resultado/ });
    await expect(advance).toBeVisible();
    await this.page.waitForTimeout(NEXT_CLICK_WAIT_MS);
    await advance.click();
  }

  /** Answer every question with any choice until the result screen appears. */
  async answerAllAny(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await expect(this.page.getByTestId("game-board")).toBeVisible();
      await this.answerAnyAndAdvance();

      const result = this.page.getByTestId("game-result");
      const board = this.page.getByTestId("game-board");
      await expect(result.or(board)).toBeVisible({ timeout: 10_000 });
      if (await result.isVisible()) {
        return;
      }
    }
    throw new Error("quiz playthrough did not reach game-result within 20 answers");
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
