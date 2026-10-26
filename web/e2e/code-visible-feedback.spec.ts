import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// The committed public example fixes the answer and the available symbols.
const puzzle = JSON.parse(readFileSync(new URL("../public/data/code-groups.pilot.json", import.meta.url), "utf8"));
const secret: string[] = puzzle.secret;
const unused: string[] = puzzle.symbols.map((symbol: { qid: string }) => symbol.qid).filter((id: string) => !secret.includes(id));

async function choose(page: Page, ids: string[]) {
  for (let index = 0; index < 4; index++) {
    await page.locator(".code-slots select").nth(index).selectOption(ids[index]!);
  }
}

async function visibleAboveBanner(page: Page, selector: string) {
  const geometry = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const banner = document.querySelector(".consent-banner")?.getBoundingClientRect();
    const visibleBottom = banner?.top ?? window.innerHeight;
    const x = rect.left + Math.min(rect.width / 2, 16);
    const y = rect.top + Math.min(rect.height / 2, 16);
    return {
      top: rect.top,
      bottom: rect.bottom,
      visibleBottom,
      hit: element.contains(document.elementFromPoint(x, y)),
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom);
  expect(geometry.hit).toBe(true);
}

for (const locale of ["pt", "en"] as const) {
  const path = locale === "pt" ? "/pt-br/codigo/" : "/en/code/";
  const submitLabel = locale === "pt" ? "Enviar palpite" : "Submit guess";
  for (const width of [360, 390]) {
    for (const consent of ["open", "rejected"] as const) {
      test(`${locale} ${width}: ${consent} banner, validation, guess and win remain visible`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 360 ? 800 : 844 });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
        await page.route("**/data/code-groups.daily.json", (route) => route.fulfill({ json: puzzle }));
        await page.route("**/data/next/code-groups.daily.json", (route) => route.fulfill({ status: 404 }));
        await page.goto(path);
        await expect(page.locator(".code-slots select")).toHaveCount(4);
        await expect(page.locator(".consent-banner")).toBeVisible();
        if (consent === "rejected") await page.getByRole("button", { name: locale === "pt" ? "Recusar Google Analytics" : "Reject Google Analytics" }).click();

        const submit = page.getByRole("button", { name: submitLabel });
        await submit.click();
        await expect(page.locator(".code-feedback")).toContainText(locale === "pt" ? "Escolha os quatro grupos" : "Choose all four groups");
        await visibleAboveBanner(page, ".code-feedback");
        await expect(page.locator(".code-history li")).toHaveCount(0);
        await choose(page, [secret[0]!, secret[1]!, secret[2]!, ""]);
        await submit.click();
        await expect(page.locator(".code-history li")).toHaveCount(0);
        await visibleAboveBanner(page, ".code-feedback");
        await choose(page, [secret[0]!, secret[0]!, secret[1]!, secret[2]!]);
        await submit.click();
        await expect(page.locator(".code-feedback")).toContainText(locale === "pt" ? "quatro grupos diferentes" : "four different groups");
        await expect(page.locator(".code-hud")).toContainText("10/10");
        await visibleAboveBanner(page, ".code-feedback");

        await choose(page, [secret[0]!, secret[2]!, unused[0]!, unused[1]!]);
        await submit.click();
        await expect(page.locator(".code-history li")).toHaveCount(1);
        await expect(page.locator(".code-feedback")).toContainText(locale === "pt" ? "1 exato, 1 deslocado" : "1 exact, 1 misplaced");
        await expect(page.locator(".code-history li")).toContainText(locale === "pt" ? "1 exato · 1 deslocado" : "1 exact · 1 misplaced");
        await visibleAboveBanner(page, ".code-feedback");
        await expect(submit).toBeFocused();

        await page.reload();
        await expect(page.locator(".code-history li")).toHaveCount(1);
        await choose(page, secret);
        await submit.click();
        await expect(page.locator(".code-result h2")).toContainText(locale === "pt" ? "Código descoberto!" : "Code solved!");
        await expect(page.locator(".code-result")).toBeFocused();
        await visibleAboveBanner(page, ".code-result h2");
      });

      test(`${locale} ${width}: ${consent} banner, loss remains visible`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 360 ? 800 : 844 });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
        await page.route("**/data/code-groups.daily.json", (route) => route.fulfill({ json: puzzle }));
        await page.route("**/data/next/code-groups.daily.json", (route) => route.fulfill({ status: 404 }));
        await page.goto(path);
        await expect(page.locator(".code-slots select")).toHaveCount(4);
        await expect(page.locator(".consent-banner")).toBeVisible();
        if (consent === "rejected") await page.getByRole("button", { name: locale === "pt" ? "Recusar Google Analytics" : "Reject Google Analytics" }).click();
        await choose(page, [secret[1]!, secret[0]!, secret[2]!, secret[3]!]);
        const submit = page.getByRole("button", { name: submitLabel });
        for (let attempt = 0; attempt < 9; attempt++) await submit.click();
        if (locale === "pt") {
          await expect(page.locator(".code-feedback")).toContainText("1 tentativa restante");
          await expect(page.locator(".code-hud")).toContainText("Tentativa restante: 1/10");
        }
        await submit.click();
        await expect(page.locator(".code-hud")).toContainText("0/10");
        await expect(page.locator(".code-result h2")).toContainText(locale === "pt" ? "Tentativas esgotadas" : "Attempts exhausted");
        await expect(page.locator(".code-result")).toBeFocused();
        await visibleAboveBanner(page, ".code-result h2");
      });
    }
  }

  test(`${locale} desktop: keyboard, share and statistics remain usable`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    await page.route("**/data/code-groups.daily.json", (route) => route.fulfill({ json: puzzle }));
    await page.route("**/data/next/code-groups.daily.json", (route) => route.fulfill({ status: 404 }));
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(path);
    await expect(page.locator(".code-slots select")).toHaveCount(4);
    await page.getByRole("button", { name: locale === "pt" ? "Recusar Google Analytics" : "Reject Google Analytics" }).click();
    const submit = page.getByRole("button", { name: submitLabel });
    for (let index = 0; index < 4; index++) {
      const select = page.locator(".code-slots select").nth(index);
      await select.focus();
      await select.press("Home");
      const option = puzzle.symbols.findIndex((symbol: { qid: string }) => symbol.qid === secret[index]) + 1;
      for (let step = 0; step < option; step++) await select.press("ArrowDown");
      await select.press("Enter");
    }
    await submit.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".code-result")).toBeFocused();
    await visibleAboveBanner(page, ".code-result h2");
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: locale === "pt" ? "Compartilhar resultado" : "Share result" }).click();
    await expect(page.getByRole("button", { name: locale === "pt" ? "Resultado copiado." : "Result copied." })).toBeVisible();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toContain(locale === "pt" ? "Código descoberto em 1 tentativa." : "Code solved in 1 attempt.");
    for (const symbol of puzzle.symbols) expect(shared).not.toContain(symbol.name);
    await page.locator("#stats-open-nav-btn").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#stats-open-nav-btn")).toBeFocused();
  });
}
