import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { StrandsPuzzle, StrandsWord } from "../../src/lib/strands-types";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";
import { fixedStrands, serveFixedStrands } from "../helpers/fixed-daily";

const STRANDS_PATH = "/pt-br/palavras-conectadas/";

function cellSelector(row: number, col: number): string {
  return `.word-search-cell[data-row="${row}"][data-col="${col}"]`;
}

export class StrandsPage {
  private puzzle: StrandsPuzzle = fixedStrands;

  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  /**
   * Opens the frozen board. Pass `served: true` when the test already routed
   * its own artifact.
   */
  async open({ served = false, path = STRANDS_PATH }: { served?: boolean; path?: string } = {}): Promise<void> {
    if (!served) this.puzzle = await serveFixedStrands(this.page);
    const url = joinBaseUrl(this.baseURL, path);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  getPuzzle(): StrandsPuzzle {
    return this.puzzle;
  }

  /**
   * Drag through every cell of a word via PointerEvents on the grid (same
   * path the component listens to). Release confirms the trail.
   */
  async findByDrag(word: StrandsWord): Promise<void> {
    const path = word.cells.map(([row, col]) => ({ row, col }));
    await this.page.locator(".word-search-grid").evaluate((grid, cells) => {
      const el = grid as HTMLElement;
      const pointOf = (row: number, col: number) => {
        const cell = el.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) throw new Error(`missing cell ${row},${col}`);
        const box = cell.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      };
      const fire = (type: string, row: number, col: number, buttons: number) => {
        const { x, y } = pointOf(row, col);
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
            clientX: x,
            clientY: y,
            buttons,
            button: buttons ? 0 : -1,
          }),
        );
      };
      const first = cells[0]!;
      fire("pointerdown", first.row, first.col, 1);
      for (const step of cells.slice(1)) {
        fire("pointermove", step.row, step.col, 1);
      }
      const last = cells[cells.length - 1]!;
      fire("pointerup", last.row, last.col, 0);
    }, path);
  }

  /** Tap each cell of a word, then press Confirm. */
  async findByTapConfirm(word: StrandsWord): Promise<void> {
    for (const [row, col] of word.cells) {
      await this.page.locator(cellSelector(row, col)).click();
    }
    await this.page.getByTestId("strands-confirm").click();
  }

  async expectFoundCount(count: number): Promise<void> {
    await expect(this.page.getByTestId("found-counter")).toContainText(
      new RegExp(`${count}\\s*(de|of)\\s*${this.puzzle.words.length}`),
      { timeout: 15_000 },
    );
  }

  async expectSpangramFound(): Promise<void> {
    await expect(this.page.getByTestId("spangram-status")).toContainText(/achado|encontrado|found/i, {
      timeout: 15_000,
    });
  }

  async completeAll({
    dragWord,
    tapWord,
  }: {
    dragWord: StrandsWord;
    tapWord: StrandsWord;
  }): Promise<void> {
    await this.findByDrag(dragWord);
    await this.expectFoundCount(1);

    await this.findByTapConfirm(tapWord);
    await this.expectFoundCount(2);

    const remaining = this.puzzle.words.filter(
      (word) => word !== dragWord && word !== tapWord,
    );
    for (const word of remaining) {
      await this.findByDrag(word);
    }
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
