import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";

/**
 * On a phone the whole map gives Singapore 0.2px, Taiwan 3px and South
 * Korea 5px. The first tap zooms into the tapped region, where every
 * country of the round has a round target of at least 44x44px that no other
 * country's target overlaps. A tap leaves no country looking picked on the
 * next date, and the bar holds only the actions that still apply.
 */

const phones = [
  { width: 360, height: 740 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

/** Mirrors NEXT_GUARD_MS in MapPilotGameContent, plus a margin. */
const NEXT_GUARD_WAIT_MS = 350;

const SMALL = [
  { id: "SGP", name: "Singapura" },
  { id: "TWN", name: "Taiwan" },
  { id: "KOR", name: "Coreia do Sul" },
] as const;

async function openMap(page: Page) {
  await page.addInitScript((key) => window.localStorage.setItem(key, "rejected"), CONSENT_STORAGE_KEY);
  await page.goto("/pt-br/mapa/");
  // The targets render once the map box is measured.
  await expect(page.locator(".map-pilot-target").first()).toBeAttached();
}

function target(page: Page, id: string): Locator {
  return page.locator(`.map-pilot-target[data-feature="${id}"]`);
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Taps the whole map where the country is; the map zooms there. */
async function zoomOn(page: Page, id: string) {
  await expect(page.locator(".map-pilot-zoom-out")).toHaveCount(0);
  const { x, y } = await center(target(page, id));
  await page.touchscreen.tap(x, y);
  await expect(page.locator(".map-pilot-zoom-out")).toBeVisible();
}

async function zoomOut(page: Page) {
  const button = page.locator(".map-pilot-zoom-out");
  const { x, y } = await center(button);
  await page.touchscreen.tap(x, y);
  await expect(button).toHaveCount(0);
}

/**
 * The country's zoomed target: at least 44x44px, whole inside the map, hit
 * by elementFromPoint at its center, and clear of every other target.
 */
async function expectTouchTarget(page: Page, id: string) {
  const report = await page.evaluate((featureId) => {
    const svg = document.querySelector(".map-pilot-world-map")!;
    const map = svg.getBoundingClientRect();
    const circles = [...document.querySelectorAll<SVGCircleElement>(".map-pilot-target.is-pickable")];
    const own = circles.find((circle) => circle.dataset.feature === featureId)!;
    const box = own.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const overlaps = circles
      .filter((circle) => circle !== own)
      .map((circle) => {
        const other = circle.getBoundingClientRect();
        const distance = Math.hypot(other.left + other.width / 2 - cx, other.top + other.height / 2 - cy);
        return { id: circle.dataset.feature, gap: distance - (other.width + box.width) / 2 };
      })
      .filter((other) => other.gap < 0);
    return {
      width: box.width,
      height: box.height,
      inside: box.left >= map.left - 0.5 && box.right <= map.right + 0.5
        && box.top >= map.top - 0.5 && box.bottom <= map.bottom + 0.5,
      hit: hit === own,
      overlaps,
    };
  }, id);
  expect(report.width, `${id} target width`).toBeGreaterThanOrEqual(44 - 0.5);
  expect(report.height, `${id} target height`).toBeGreaterThanOrEqual(44 - 0.5);
  expect(report.inside, `${id} target inside the map`).toBe(true);
  expect(report.hit, `a tap at the center of ${id} reaches its target`).toBe(true);
  expect(report.overlaps, `targets overlapping ${id}`).toEqual([]);
}

async function barControls(page: Page): Promise<string[]> {
  return page.locator(".map-pilot-actions").evaluate((bar) => [...bar.querySelectorAll<HTMLElement>("button, select")]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => (el.tagName === "SELECT" ? "select" : el.textContent!.trim())));
}

/** Every control of the bar sits inside the bar's padding. */
async function expectBarControlsInside(page: Page) {
  const outside = await page.locator(".map-pilot-actions").evaluate((bar) => {
    const style = getComputedStyle(bar);
    const rect = bar.getBoundingClientRect();
    const left = rect.left + parseFloat(style.paddingLeft);
    const right = rect.right - parseFloat(style.paddingRight);
    return [...bar.querySelectorAll<HTMLElement>("button, select")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el: el.textContent!.trim().slice(0, 20), rect: el.getBoundingClientRect() }))
      .filter(({ rect: box }) => box.left < left - 0.5 || box.right > right + 0.5)
      .map(({ el, rect: box }) => `${el}: ${box.left.toFixed(1)}-${box.right.toFixed(1)} outside ${left.toFixed(1)}-${right.toFixed(1)}`);
  });
  expect(outside).toEqual([]);
}

for (const phone of phones) {
  test.describe(`map on a ${phone.width}x${phone.height} touch screen`, () => {
    test.use({ viewport: phone, isMobile: true, hasTouch: true });

    test("Singapore, Taiwan and South Korea are picked by touch from the zoomed map", async ({ page }) => {
      await openMap(page);
      const select = page.locator(".map-pilot-select");
      for (const { id, name } of SMALL) {
        await zoomOn(page, id);
        await expectTouchTarget(page, id);
        const point = await center(target(page, id));
        await page.touchscreen.tap(point.x, point.y);
        await expect(page.locator(`path[aria-label="${name}"]`)).toHaveAttribute("aria-pressed", "true");
        await expect(target(page, id)).toHaveClass(/is-selected/);
        await expect(select).toHaveValue(id);
        await zoomOut(page);
      }
      // The pick survives the zoom out; Answer sends it.
      await page.locator(".map-pilot-actions .btn-primary").tap();
      // The verdict names the pick when it is wrong; the day's first date may be in Korea.
      await expect(page.locator(".game-actions-message")).toContainText(/Resposta correta\.|Sua resposta: Coreia do Sul/);
    });

    test("every country of the round has a 44px target of its own in the zoomed map", async ({ page }) => {
      await openMap(page);
      const ids = await page.locator(".map-pilot-target").evaluateAll((circles) =>
        circles.map((circle) => (circle as SVGCircleElement).dataset.feature!));
      expect(ids).toHaveLength(14);
      for (const id of ids) {
        await zoomOn(page, id);
        await expectTouchTarget(page, id);
        await zoomOut(page);
      }
    });

    test("no country looks picked on the next date after a tap", async ({ page }) => {
      await openMap(page);
      await zoomOn(page, "CAN");
      const canada = await center(target(page, "CAN"));
      await page.touchscreen.tap(canada.x, canada.y);
      await expect(page.locator('path[aria-label="Canadá"]')).toHaveAttribute("aria-pressed", "true");
      await page.locator(".map-pilot-actions .btn-primary").tap();
      const next = page.locator(".map-pilot-actions .btn-primary");
      await expect(next).toHaveText(/Próxima data|Ver resultado/);
      await page.waitForTimeout(NEXT_GUARD_WAIT_MS);
      await next.tap();
      await expect(page.locator(".map-pilot-progress")).toHaveText("Pergunta 2 de 10");

      // A touch leaves :hover on what it touched; the mouse puts it back there.
      const world = await center(target(page, "CAN"));
      await page.mouse.move(world.x, world.y);
      const state = await page.evaluate(() => {
        const paths = [...document.querySelectorAll<SVGPathElement>(".map-pilot-feature.is-playable")];
        const canada = paths.find((path) => path.getAttribute("aria-label") === "Canadá")!;
        const fills = new Set(paths.map((path) => getComputedStyle(path).fill));
        return {
          hovered: document.querySelector(".map-pilot-world-map")!.matches(":hover"),
          picked: document.querySelectorAll(".map-pilot-world-map .is-selected, .map-pilot-world-map [aria-pressed='true']").length,
          fills: fills.size,
          canadaFill: getComputedStyle(canada).fill,
        };
      });
      expect(state.hovered, "the mouse hovers the map").toBe(true);
      expect(state.picked).toBe(0);
      expect(state.fills, `every country of the round shares one fill (Canada: ${state.canadaFill})`).toBe(1);
      await expect(page.locator(".map-pilot-select")).toHaveValue("");
    });

    test("the bar holds only the actions that apply, inside the card", async ({ page }) => {
      await openMap(page);
      expect(await barControls(page)).toEqual(["select", "Responder", "Desistir"]);
      await expectBarControlsInside(page);

      await page.locator(".map-pilot-select").selectOption("SGP");
      await page.locator(".map-pilot-actions .btn-primary").tap();
      await expect(page.locator(".game-actions-message")).toContainText("País correto");
      expect(await barControls(page)).toEqual(["Próxima data"]);
      await expectBarControlsInside(page);

      const width = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    });

    test("the map box fills the room above the bar", async ({ page }) => {
      await openMap(page);
      const sizes = await page.evaluate(() => {
        const map = document.querySelector(".map-pilot-world-map")!.getBoundingClientRect();
        const bar = document.querySelector(".map-pilot-actions")!.getBoundingClientRect();
        return { width: map.width, height: map.height, top: map.top, bottom: map.bottom, barTop: bar.top };
      });
      test.info().annotations.push({
        type: "map box",
        description: `${sizes.width.toFixed(0)}x${sizes.height.toFixed(0)} from y=${sizes.top.toFixed(0)}, bar at y=${sizes.barTop.toFixed(0)}`,
      });
      // The whole world alone was a strip 2.5 times wider than tall.
      expect(sizes.height).toBeGreaterThan(sizes.width / 2.5 + 30);
      // The question's map, its answer controls and Answer fit one screen.
      expect(sizes.bottom).toBeLessThanOrEqual(sizes.barTop + 0.5);
    });
  });
}
