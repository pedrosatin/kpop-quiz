import type { Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";

const THEME_KEY = "kpop-quiz-theme";
const WIDTHS = [320, 360, 390] as const;
const LOCALES = [
  { path: "/pt-br/", short: "EN", lang: "en", language: "English", cycle: ["Tema do sistema", "Tema claro", "Tema escuro"] },
  { path: "/en/", short: "PT", lang: "pt-BR", language: "Português", cycle: ["System theme", "Light theme", "Dark theme"] },
] as const;

/** Box of each header control, in the order the header lists them. */
async function headerControls(page: Page) {
  return page.locator(".site-header").evaluate((header) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return {
      header: box(header),
      controls: Array.from(header.querySelectorAll<HTMLElement>("a, button")).map((el) => ({
        name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName,
        ...box(el),
      })),
    };
  });
}

const centerY = (box: { top: number; bottom: number }) => (box.top + box.bottom) / 2;

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`header ${locale.path} at ${width}px: brand, stats, theme and language share one row`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 740 });
      await page.goto(joinBaseUrl(baseURL!, locale.path));

      const { header, controls } = await headerControls(page);
      expect(controls).toHaveLength(4);
      // One row: every control is centered on the same line, inside the header.
      for (const control of controls) {
        expect(Math.abs(centerY(control) - centerY(controls[0]!)), `${control.name} sits on the first row`).toBeLessThanOrEqual(1);
        expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
        expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(width);
      }
      expect(header.height).toBeLessThanOrEqual(64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

      // The language link shows only the code; its name stays the full language, in that language.
      const language = page.getByRole("link", { name: locale.language });
      await expect(language).toHaveText(locale.short, { useInnerText: true });
      await expect(language).toHaveAttribute("lang", locale.lang);
    });
  }

  test(`header ${locale.path}: theme button cycles system, light and dark and remembers the choice`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(joinBaseUrl(baseURL!, locale.path));
    const html = page.locator("html");
    const button = page.locator("#theme-toggle");
    const [system, light, dark] = locale.cycle;

    // The name says the current theme and the next one.
    await expect(button).toHaveAccessibleName(new RegExp(`^${system}\\. .+ ${light.toLowerCase()}$`));
    await expect(html).not.toHaveAttribute("data-theme", /.*/);

    await button.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(button).toHaveAccessibleName(new RegExp(`^${light}\\. .+ ${dark.toLowerCase()}$`));
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe("light");

    await button.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(button).toHaveAccessibleName(new RegExp(`^${dark}\\. .+ ${system.toLowerCase()}$`));
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe("dark");

    // The saved theme is on <html> before the page paints, so a reload does not flash the other one.
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(button).toHaveAccessibleName(new RegExp(`^${dark}\\. `));

    await button.click();
    await expect(html).not.toHaveAttribute("data-theme", /.*/);
    await expect(button).toHaveAccessibleName(new RegExp(`^${system}\\. `));
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBeNull();
  });
}

test("header at 1280px keeps the stats label and the full language name on one row", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(joinBaseUrl(baseURL!, "/pt-br/"));
  const { header, controls } = await headerControls(page);
  expect(header.height).toBeLessThanOrEqual(64);
  for (const control of controls) expect(Math.abs(centerY(control) - centerY(controls[0]!))).toBeLessThanOrEqual(1);
  await expect(page.getByRole("link", { name: "English" })).toHaveText("English", { useInnerText: true });
});
