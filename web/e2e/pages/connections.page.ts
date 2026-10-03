import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { SUBMIT_GUARD_MS } from "../../src/components/Connections/ConnectionsGameContent";
import { joinBaseUrl } from "../../src/lib/join-base-url";
import { expectBoardDirectReady } from "../helpers/boot";
import { loadPreferNextDaily } from "../helpers/daily-artifact";

/** Buffer past Submit guard so a second Enviar is not swallowed. */
const SUBMIT_CLICK_WAIT_MS = SUBMIT_GUARD_MS + 50;

const CONNECTIONS_PATH = "/pt-br/conexoes/";

interface ConnectionsDaily {
  reference_date: string;
  items: Array<{
    id: string;
    canonical_name: string;
    labels: Record<string, string>;
  }>;
  categories: Array<{ id: string; item_ids: string[] }>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ConnectionsPage {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  async open(): Promise<void> {
    const url = joinBaseUrl(this.baseURL, CONNECTIONS_PATH);
    const response = await this.page.goto(url);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();
    await expectBoardDirectReady(this.page);
  }

  /** Four distinct wrong groups (one tile from each category) → lost. */
  async loseWithWrongGuesses(): Promise<void> {
    const puzzle = await loadPreferNextDaily<ConnectionsDaily>(
      this.page.request,
      this.baseURL,
      "connections.daily.json",
    );
    const byId = new Map(puzzle.items.map((item) => [item.id, item]));
    const board = this.page.getByTestId("game-board");

    for (let i = 0; i < 4; i += 1) {
      const clear = board.getByRole("button", { name: "Limpar seleção" });
      const submit = board.getByRole("button", { name: "Enviar" });
      if (await clear.isEnabled()) {
        await clear.click();
        // Wrong submits leave the prior group selected; wait until clear settles.
        await expect(submit).toBeDisabled();
      }

      const ids = puzzle.categories.map((cat) => cat.item_ids[i]!);
      for (const id of ids) {
        const item = byId.get(id);
        expect(item, `connections item ${id}`).toBeTruthy();
        const label = item!.labels["pt-BR"] || item!.canonical_name;
        const tile = board.getByRole("button", {
          name: new RegExp(`^${escapeRegExp(label)},`),
        });
        await expect(tile).toBeVisible();
        await tile.click();
      }

      await expect(submit).toBeEnabled();
      await this.page.waitForTimeout(SUBMIT_CLICK_WAIT_MS);
      await submit.click();
    }

    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }

  async expectResult(): Promise<void> {
    await expect(this.page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  }
}
