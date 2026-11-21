import { expect, test } from "./fixtures/consent";
import { serveFixedGrid } from "./helpers/fixed-daily";
import { visibleLabels } from "./helpers/visible-names";
import { joinBaseUrl } from "../src/lib/join-base-url";

type Candidate = { id: string; canonical_name: string; names: Record<string, string>; aliases?: string[] };

/** A name as a fan types it fast: lower case, no spaces, no punctuation. Written apart from the product. */
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const isLatin = (name: string) => /^[\x20-\x7e]+$/.test(name);

const viewports = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

for (const viewport of viewports) {
  test(`grid pt ${viewport.name}: the picker finds a group typed without spaces or punctuation, and by an alias`, async ({ page, baseURL }) => {
    const grid = await serveFixedGrid(page, { guardClock: false });
    const labels = visibleLabels(
      grid.candidate_pool.map((c) => ({ id: c.id, canonical_name: c.canonical_name, labels: c.names })),
      "pt-BR",
    );
    // A group whose shown name has a space or a mark, such as "Stray Kids" or "T-ara".
    const spaced = grid.candidate_pool.find((c) => {
      const label = labels.get(c.id)!;
      return isLatin(label) && /[^A-Za-z0-9]/.test(label.trim()) && squash(label).length >= 3;
    });
    expect(spaced, "frozen pool must include a spaced Latin name").toBeTruthy();

    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(joinBaseUrl(baseURL!, "/pt-br/grid/"));
    await expect(page.getByTestId("game-board")).toBeVisible();
    await page.getByTestId("game-board").locator('.grid-cell-btn[data-row="0"][data-col="0"]').click();
    const listbox = page.getByRole("listbox");
    const search = page.getByRole("combobox");
    await expect(listbox).toBeVisible();

    await search.fill(squash(labels.get(spaced!.id)!));
    await expect(listbox.locator(`[id="candidate-opt-${spaced!.id}"]`)).toBeVisible();

    // Frozen board carries aliases: an alias no shown name contains finds its
    // group and appears beside the name.
    const aliased = grid.candidate_pool
      .flatMap((c: Candidate) => (c.aliases ?? []).map((alias) => ({ c, alias })))
      .find(({ c, alias }) => {
        const key = squash(alias);
        const shown = [c.canonical_name, c.names["pt-BR"]!, c.names.en!, labels.get(c.id)!].map(squash);
        return isLatin(alias) && key.length >= 3 && shown.every((name) => !name.includes(key));
      });
    expect(aliased, "frozen pool must include a distinct Latin alias").toBeTruthy();
    await search.fill(aliased!.alias);
    const option = listbox.locator(`[id="candidate-opt-${aliased!.c.id}"]`);
    await expect(option).toBeVisible();
    await expect(option.locator(".candidate-alias")).toBeVisible();
  });
}
