import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { reloadPersisted } from "./helpers/passive-effects";

// The committed public example fixes the answer and the available symbols.
const puzzle = JSON.parse(readFileSync(new URL("../public/data/code-groups.pilot.json", import.meta.url), "utf8"));
const secret: string[] = puzzle.secret;
const unused: string[] = puzzle.symbols.map((symbol: { qid: string }) => symbol.qid).filter((id: string) => !secret.includes(id));

// Explicit build contract. A mismatched artifact fails instead of dropping banner assertions.
const prefix = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const configuredBase = process.env.BASE_URL?.trim() || "http://127.0.0.1:4321";
const staging = prefix !== "" || new URL(configuredBase).pathname !== "/";
const environment = process.env.CODE_FEEDBACK_ENV ?? (staging ? "staging" : "root");
if (!["banner", "root", "staging"].includes(environment)) throw new Error("Invalid CODE_FEEDBACK_ENV");
if ((environment === "staging") !== staging) throw new Error("CODE_FEEDBACK_ENV must match ASTRO_BASE/BASE_URL");
const expectBeacon = process.env.CODE_FEEDBACK_CF_BEACON === "true";
if (environment === "staging" && expectBeacon) throw new Error("Staging cannot expect analytics");
const consentStates = environment === "banner" ? ["open", "rejected"] as const : ["absent"] as const;

async function openFixture(page: Page, baseURL: string, path: string, locale: string, consent: string) {
  // Local preview strips the baseURL path; remote runs retain it. Add ASTRO_BASE only once.
  const base = new URL(baseURL);
  if (base.pathname === "/") base.pathname = prefix ? `${prefix}/` : new URL(configuredBase).pathname;
  const url = joinBaseUrl(base.href, path);
  const origin = new URL(url).origin;
  await page.route("**/*", async (route) => {
    const request = new URL(route.request().url());
    if (request.origin !== origin) return route.abort();
    if (request.pathname === new URL(joinBaseUrl(base.href, "/data/code-groups.daily.json")).pathname) return route.fulfill({ json: puzzle });
    if (request.pathname === new URL(joinBaseUrl(base.href, "/data/next/code-groups.daily.json")).pathname) return route.fulfill({ status: 404 });
    return route.continue();
  });
  await page.addInitScript(() => {
    Object.assign(window, { __codeScrolls: [] as string[] });
    const record = (name: string) => (window as unknown as { __codeScrolls: string[] }).__codeScrolls.push(name);
    window.scrollBy = new Proxy(window.scrollBy, {
      apply(target, thisArg, args) {
        record("window.scrollBy");
        return Reflect.apply(target, thisArg, args);
      },
    });
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      if (this.closest("#code-groups")) record("code.scrollIntoView");
      scrollIntoView.call(this, options);
    };
  });
  const response = await page.goto(url);
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(new URL(url).pathname);
  await expect(page.locator(".code-slots select")).toHaveCount(4);
  const html = await response!.text();
  const island = page.locator('astro-island[component-url*="ConsentBanner"]');
  if (environment === "banner") {
    await expect(island).toHaveCount(1);
    await expect(page.locator(".consent-banner")).toBeVisible();
    if (consent === "rejected") {
      await page.getByRole("button", { name: locale === "pt" ? "Recusar Google Analytics" : "Reject Google Analytics" }).click();
      await expect(page.locator(".consent-banner")).toHaveCount(0);
    }
  } else {
    await expect(island).toHaveCount(0);
    await expect(page.locator(".consent-banner")).toHaveCount(0);
    expect(html).not.toMatch(/googletagmanager\.com|google-analytics\.com/);
    expect(html.includes("cloudflareinsights.com")).toBe(expectBeacon);
    await expect(page.locator('script[src*="googletagmanager"], script[src*="google-analytics"]')).toHaveCount(0);
    await expect(page.locator('script[src*="cloudflareinsights"]')).toHaveCount(expectBeacon ? 1 : 0);
  }
  if (environment === "staging") await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  else await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
}

async function codeScrolls(page: Page) {
  // Let Preact effects and browser layout finish before checking passive updates.
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return (window as unknown as { __codeScrolls: string[] }).__codeScrolls;
  });
}

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
  for (const width of [360, 390, 1280]) {
    for (const consent of consentStates) {
      test(`${environment} ${locale} ${width}: ${consent} banner, validation, guess and win remain visible`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await openFixture(page, baseURL!, path, locale, consent);

        const submit = page.getByRole("button", { name: submitLabel });
        await submit.click();
        await expect(page.locator(".code-feedback")).toContainText(locale === "pt" ? "Escolha os quatro grupos" : "Choose all four groups");
        await visibleAboveBanner(page, ".code-feedback");
        await expect(submit).toBeFocused();
        await expect(page.locator(".code-feedback")).toHaveAttribute("role", "status");
        await expect(page.locator(".code-feedback")).toHaveAttribute("aria-live", "polite");
        await expect(page.locator(".code-feedback")).toHaveAttribute("aria-atomic", "true");
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

        const scrolls = await codeScrolls(page);
        await page.locator(".code-slots select").first().focus();
        await page.locator(".code-slots select").first().selectOption(secret[1]!);
        await expect(page.locator(".code-slots select").first()).toBeFocused();
        expect(await codeScrolls(page)).toEqual(scrolls);
        await reloadPersisted(page);
        await expect(page.locator(".code-history li")).toHaveCount(1);
        expect(await codeScrolls(page)).toEqual([]);
        await choose(page, secret);
        await submit.click();
        await expect(page.locator(".code-result h2")).toContainText(locale === "pt" ? "Código descoberto!" : "Code solved!");
        await expect(page.locator(".code-result")).toBeFocused();
        await visibleAboveBanner(page, ".code-result h2");
        await reloadPersisted(page);
        await expect(page.locator(".code-result h2")).toBeVisible();
        await expect(page.locator(".code-result")).not.toBeFocused();
        expect(await codeScrolls(page)).toEqual([]);
      });

      test(`${environment} ${locale} ${width}: ${consent} banner, loss remains visible`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await openFixture(page, baseURL!, path, locale, consent);
        await choose(page, [secret[1]!, secret[0]!, secret[2]!, secret[3]!]);
        const submit = page.getByRole("button", { name: submitLabel });
        for (let attempt = 0; attempt < 9; attempt++) await submit.click();
        await expect(page.locator(".code-feedback")).toContainText(locale === "pt" ? "1 tentativa restante" : "1 attempt remaining.");
        if (locale === "pt") {
          await expect(page.locator(".code-feedback")).toContainText("1 tentativa restante");
          await expect(page.locator(".code-hud")).toContainText("Tentativa restante: 1/10");
        }
        await submit.click();
        await expect(page.locator(".code-hud")).toContainText("0/10");
        await expect(page.locator(".code-result h2")).toContainText(locale === "pt" ? "Tentativas esgotadas" : "Attempts exhausted");
        await expect(page.locator(".code-result")).toBeFocused();
        await visibleAboveBanner(page, ".code-result h2");
        await reloadPersisted(page);
        await expect(page.locator(".code-result h2")).toBeVisible();
        await expect(page.locator(".code-result")).not.toBeFocused();
        expect(await codeScrolls(page)).toEqual([]);
      });
    }
  }

  test(`${environment} ${locale} desktop: keyboard, share and statistics remain usable`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFixture(page, baseURL!, path, locale, environment === "banner" ? "rejected" : "absent");
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
