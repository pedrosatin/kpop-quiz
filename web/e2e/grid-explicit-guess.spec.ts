import { expect, test } from "./fixtures/consent";
import { loadPreferNextDaily } from "./helpers/daily-artifact";
import { visibleLabels } from "./helpers/visible-names";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { CELL_GUARD_MS } from "../src/components/Grid/next-cell-after-guess";
import { reloadPersisted } from "./helpers/passive-effects";

type Grid = {
  reference_date: string;
  candidate_pool: { id: string; canonical_name: string; names: Record<string, string> }[];
  cells: { row_index: number; col_index: number; valid_entity_ids: string[] }[];
};

const locales = [
  {
    id: "pt",
    locale: "pt-BR",
    path: "/pt-br/grid/",
    full: "9 palpites restantes",
    left: "8 palpites restantes",
    repeat: (name: string) => `Já tentado aqui: ${name}. Nenhum palpite gasto.`,
    tried: "Já tentado aqui",
  },
  {
    id: "en",
    locale: "en",
    path: "/en/grid/",
    full: "9 guesses left",
    left: "8 guesses left",
    repeat: (name: string) => `Already tried here: ${name}. No guess spent.`,
    tried: "Already tried here",
  },
] as const;

const viewports = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

for (const locale of locales)
  for (const viewport of viewports) {
    test(`grid ${locale.id} ${viewport.name}: Enter on an empty search and a repeated group spend no guess`, async ({ page, request, baseURL }) => {
      const grid = await loadPreferNextDaily<Grid>(request, baseURL!, "grid.daily.json");
      const cell = grid.cells.find((c) => c.row_index === 0 && c.col_index === 0)!;
      const labels = visibleLabels(
        grid.candidate_pool.map((c) => ({ id: c.id, canonical_name: c.canonical_name, labels: c.names })),
        locale.locale,
      );
      // A refused group whose name no other group shares, so typing it names it.
      const refused = grid.candidate_pool.find((c) => {
        if (cell.valid_entity_ids.includes(c.id)) return false;
        const name = labels.get(c.id)!.toLowerCase();
        return grid.candidate_pool.filter((o) => labels.get(o.id)!.toLowerCase() === name).length === 1;
      })!;
      const name = labels.get(refused.id)!;

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(joinBaseUrl(baseURL!, locale.path));
      const board = page.getByTestId("game-board");
      await expect(board).toBeVisible();
      const target = board.locator('.grid-cell-btn[data-row="0"][data-col="0"]');
      const progress = page.locator(".grid-progress");
      const listbox = page.getByRole("listbox");
      const search = page.getByRole("combobox");

      // Enter with nothing typed and nothing highlighted sends nothing.
      await target.click();
      await expect(listbox).toBeVisible();
      await expect(search).toBeFocused();
      await search.press("Enter");
      await expect(listbox).toBeVisible();
      await expect(listbox.getByRole("option", { selected: true })).toHaveCount(0);
      await expect(progress).toContainText(locale.full);

      // The first refusal is spent.
      await listbox.getByRole("option", { name, exact: true }).click();
      await expect(listbox).toBeHidden();
      await expect(progress).toContainText(locale.left);

      // The picker marks the group as tried here, and naming it again is free.
      await page.waitForTimeout(CELL_GUARD_MS + 100);
      await target.click();
      await expect(listbox).toBeVisible();
      await expect(listbox.getByRole("option", { name: new RegExp(`^${escapeRegExp(name)}`) })).toContainText(locale.tried);
      await search.fill(name);
      await search.press("Enter");
      await expect(listbox).toBeHidden();
      await expect(page.locator(".grid-actions").getByRole("status")).toContainText(locale.repeat(name));
      await expect(progress).toContainText(locale.left);
      await expect(target).toBeFocused();

      if (process.env.GRID_SHOTS) {
        await page.screenshot({ path: `${process.env.GRID_SHOTS}/depois-grid-${locale.id}-${viewport.name}-repetido.png` });
      }

      await reloadPersisted(page);
      await expect(board).toBeVisible();
      await expect(progress).toContainText(locale.left);
    });
  }

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
