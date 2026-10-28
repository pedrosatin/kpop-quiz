import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures/consent";
import { visibleLabels } from "./helpers/visible-names";
import { joinBaseUrl } from "../src/lib/join-base-url";

// A grid published before the label said "Formado/Formed" (2026-10-26, frozen
// from the daily publication), served as the day's artifact. The fallback
// reuses such a file byte for byte, so players can still receive it.
const legacy = JSON.parse(
  readFileSync(new URL("../src/tests/fixtures/grid.published-legacy-20261026.json", import.meta.url), "utf8"),
) as {
  grid_id: string;
  candidate_pool: { id: string; canonical_name: string; names: Record<string, string> }[];
  cells: { row_index: number; col_index: number; valid_entity_ids: string[] }[];
};

const locales = [
  {
    id: "pt",
    locale: "pt-BR",
    path: "/pt-br/grid/",
    tag: "Formação",
    formed: ["Formado nos anos 2000", "Formado nos anos 2010"],
    others: ["5 ou menos integrantes", "DSP Media", "JYP Entertainment", "YG Entertainment"],
    old: /Estreou|Estreia/,
    left: "8 palpites restantes",
  },
  {
    id: "en",
    locale: "en",
    path: "/en/grid/",
    tag: "Formation",
    formed: ["Formed in the 2000s", "Formed in the 2010s"],
    others: ["5 or fewer members", "DSP Media", "JYP Entertainment", "YG Entertainment"],
    old: /Debuted|Debut/,
    left: "8 guesses left",
  },
] as const;

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

for (const locale of locales)
  for (const viewport of viewports) {
    test(`grid ${locale.id} ${viewport.name}: a legacy decade label reads as formation, keeps its save and survives a reload`, async ({ page, baseURL }) => {
      await page.route("**/data/grid.daily.json*", (route) => route.fulfill({ json: legacy }));
      await page.route("**/data/next/grid.daily.json*", (route) => route.fulfill({ status: 404, body: "" }));
      await page.route("**/data/**/grid-publication.*", (route) => route.fulfill({ status: 404, body: "" }));
      await page.route("**/data/grid-publication.*", (route) => route.fulfill({ status: 404, body: "" }));

      const labels = visibleLabels(
        legacy.candidate_pool.map((c) => ({ id: c.id, canonical_name: c.canonical_name, labels: c.names })),
        locale.locale,
      );
      const cell = legacy.cells.find((c) => c.row_index === 0 && c.col_index === 0)!;
      const answer = labels.get(cell.valid_entity_ids[0]!)!;

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(joinBaseUrl(baseURL!, locale.path));
      const board = page.getByTestId("game-board");
      await expect(board).toBeVisible();

      const expectFormation = async () => {
        const text = await board.innerText();
        for (const label of [...locale.formed, ...locale.others]) expect(text).toContain(label);
        expect(text).not.toMatch(locale.old);
        const headers = board.locator("th .criterion-category");
        await expect(headers.filter({ hasText: locale.tag })).toHaveCount(2);
        for (const label of await board.locator("th .criterion-label").all()) {
          const cut = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
          expect(cut, "a criterion label must not be cut").toBe(false);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      };
      await expectFormation();

      await board.locator('.grid-cell-btn[data-row="0"][data-col="0"]').click();
      await page.getByRole("listbox").getByRole("option", { name: answer, exact: true }).click();
      await expect(page.locator(".grid-progress")).toContainText(locale.left);

      // The save belongs to the published identity and holds no label text.
      const saved = await page.evaluate((key) => localStorage.getItem(key), `kpop-grid-${legacy.grid_id}`);
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved!).cells["0,0"]).toMatchObject({ solved: true, entityId: cell.valid_entity_ids[0] });
      expect(saved).not.toMatch(/Estreou|Debuted|Formado|Formed/);

      if (process.env.I05_SHOTS) {
        await page.screenshot({ path: `${process.env.I05_SHOTS}/grid-legacy-${locale.id}-${viewport.name}.png` });
      }

      await page.reload();
      await expect(board).toBeVisible();
      await expect(page.locator(".grid-progress")).toContainText(locale.left);
      await expect(board.locator('.grid-cell-btn[data-row="0"][data-col="0"]')).toHaveClass(/solved/);
      await expectFormation();
      expect(await page.evaluate((key) => localStorage.getItem(key), `kpop-grid-${legacy.grid_id}`)).toBe(saved);
    });
  }
