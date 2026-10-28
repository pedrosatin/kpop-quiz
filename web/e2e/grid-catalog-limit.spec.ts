import { expect, test } from "./fixtures/consent";
import { loadPreferNextDaily } from "./helpers/daily-artifact";
import { visibleLabels } from "./helpers/visible-names";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { CELL_GUARD_MS } from "../src/components/Grid/next-cell-after-guess";

type Grid = {
  candidate_pool: { id: string; canonical_name: string; names: Record<string, string> }[];
  cells: { row_index: number; col_index: number; valid_entity_ids: string[] }[];
};

const locales = [
  {
    id: "pt",
    locale: "pt-BR",
    path: "/pt-br/grid/",
    refused: /^Não aceita: .+\. O catálogo só aceita fatos comprovados\./,
    left: "8 palpites restantes",
    review: /Um grupo real pode ficar de fora/,
    giveUp: "Desistir",
    confirm: "Sim, desistir",
  },
  {
    id: "en",
    locale: "en",
    path: "/en/grid/",
    refused: /^Not accepted: .+\. The catalog only accepts proven facts\./,
    left: "8 guesses left",
    review: /A real group can be left out/,
    giveUp: "Give up",
    confirm: "Yes, give up",
  },
] as const;

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

for (const locale of locales)
  for (const viewport of viewports) {
    test(`grid ${locale.id} ${viewport.name}: a refused guess explains the catalog, keeps the guess spent and hides the answers`, async ({ page, request, baseURL }) => {
      const grid = await loadPreferNextDaily<Grid & { reference_date: string }>(request, baseURL!, "grid.daily.json");
      const cell = grid.cells.find((c) => c.row_index === 0 && c.col_index === 0)!;
      const labels = visibleLabels(
        grid.candidate_pool.map((c) => ({ id: c.id, canonical_name: c.canonical_name, labels: c.names })),
        locale.locale,
      );
      const refused = grid.candidate_pool.find((c) => !cell.valid_entity_ids.includes(c.id))!;
      const answers = cell.valid_entity_ids.map((id) => labels.get(id)!);

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(joinBaseUrl(baseURL!, locale.path));
      const board = page.getByTestId("game-board");
      await expect(board).toBeVisible();

      await board.locator('.grid-cell-btn[data-row="0"][data-col="0"]').click();
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();
      await listbox.getByRole("option", { name: labels.get(refused.id)!, exact: true }).click();
      await expect(listbox).toBeHidden();

      const bar = page.locator(".grid-actions");
      const message = bar.getByRole("status");
      await expect(message).toContainText(locale.refused);
      await expect(bar.locator(".grid-progress")).toContainText(locale.left);
      const text = (await message.innerText()).toLowerCase();
      for (const answer of answers) expect(text).not.toContain(answer.toLowerCase());
      expect(text).not.toMatch(/wrong|incorrect|false|errada|falsa/);

      // Both lines are whole on screen: neither is cut by an ellipsis or by the two-line message.
      const paragraph = message.locator("p").first();
      for (const line of [".grid-verdict", ".grid-catalog-limit"]) {
        const cut = await paragraph.locator(line).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(cut, `${line} must not be cut`).toBe(false);
      }
      const clipped = await paragraph.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
      expect(clipped, "the verdict and the catalog note must not be clipped").toBe(false);
      const box = (await paragraph.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      const giveUp = bar.getByRole("button", { name: locale.giveUp });
      await expect(giveUp).toBeInViewport({ ratio: 1 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      if (process.env.I05_SHOTS) {
        await page.screenshot({ path: `${process.env.I05_SHOTS}/grid-${locale.id}-${viewport.name}-refused.png` });
      }

      // The spent guess survives a reload, and the finished review repeats the limit.
      await page.reload();
      await expect(board).toBeVisible();
      await expect(page.locator(".grid-progress")).toContainText(locale.left);
      await page.waitForTimeout(CELL_GUARD_MS + 100);
      await giveUp.click();
      await page.getByRole("button", { name: locale.confirm }).click();
      await expect(page.locator(".grid-result")).toBeVisible();
      // Giving up opens the answers and sources.
      await expect(page.getByText(locale.review)).toBeVisible();
      if (process.env.I05_SHOTS) {
        await page.screenshot({ path: `${process.env.I05_SHOTS}/grid-${locale.id}-${viewport.name}-result.png`, fullPage: true });
      }
    });
  }
