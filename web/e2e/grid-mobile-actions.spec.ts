import { test as base, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preview } from "astro";

// Build the real consent island independently of production secrets or BASE_URL.
const test = base.extend<{}, { consentURL: string }>({
  consentURL: [async ({}, use) => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const scratch = join(root, "../.scratch");
    await mkdir(scratch, { recursive: true });
    // Astro moves assets by rename, so output must share the source filesystem.
    const outDir = await mkdtemp(join(scratch, "grid-consent-"));
    let server: Awaited<ReturnType<typeof preview>> | undefined;
    try {
      await promisify(execFile)(process.execPath, ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "production",
          ASTRO_BASE: "",
          BASE_URL: "/",
          PUBLIC_GA4_ID: "G-E2EGRID296",
          PUBLIC_CF_BEACON_TOKEN: "",
        },
        timeout: 120_000,
      });
      server = await preview({ root, outDir, base: "/", server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
      await use(`http://127.0.0.1:${server.port}`);
    } finally {
      await server?.stop();
      await rm(outDir, { recursive: true, force: true });
    }
  }, { scope: "worker", timeout: 120_000 }],
});

test.use({ serviceWorkers: "block" });

const locales = [
  { id: "pt", path: "/pt-br/grid/", hint: /Escolha uma casa/, giveUp: "Desistir", reject: /^Recusar Google Analytics$/ },
  { id: "en", path: "/en/grid/", hint: /Pick a square/, giveUp: "Give up", reject: /^Reject Google Analytics$/ },
] as const;
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

for (const locale of locales)
  for (const viewport of viewports)
    for (const consent of ["open", "rejected"] as const) {
      test(`grid ${locale.id} ${viewport.width}x${viewport.height} banner ${consent}: bar fits the screen`, async ({ page, context, consentURL }) => {
        await page.setViewportSize(viewport);
        await context.route("**/*", (route) => new URL(route.request().url()).origin === consentURL
          ? route.continue()
          : route.abort());
        await page.goto(consentURL + locale.path);
        const banner = page.locator(".consent-banner");
        await expect(banner, "the consent build must render the real banner").toBeVisible();
        const bar = page.locator(".grid-actions");
        await expect(bar).toBeVisible();
        if (consent === "rejected") {
          await banner.getByRole("button", { name: locale.reject }).click();
          await expect(banner).toHaveCount(0);
        }
        await expectNoHorizontalOverflow(page);

        // The hint keeps real width and shows its whole line.
        const hint = bar.getByRole("status");
        await expect(hint).toContainText(locale.hint);
        const hintBox = (await hint.boundingBox())!;
        expect(hintBox.width).toBeGreaterThan(viewport.width / 2);

        // Progress and the button sit inside the screen; the button is what a tap hits.
        const giveUp = bar.getByRole("button", { name: locale.giveUp });
        await expect(giveUp).toBeInViewport({ ratio: 1 });
        const box = (await giveUp.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.height).toBeGreaterThanOrEqual(44);
        const progress = (await bar.locator(".grid-progress").boundingBox())!;
        expect(progress.x + progress.width).toBeLessThanOrEqual(box.x);
        const hit = await giveUp.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top === el || el.contains(top);
        });
        expect(hit).toBe(true);

        // Giving up still works from the bar after confirmation; the finished bar fits too.
        await giveUp.click();
        await page.getByRole("button", { name: locale.id === "pt" ? "Sim, desistir" : "Yes, give up" }).click();
        await expect(page.locator(".grid-result")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        if (consent === "open") await expect(banner).toBeVisible();
        await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem("kpop-quiz-consent")))
          .toBe(consent === "rejected" ? "rejected" : null);
      });
    }
