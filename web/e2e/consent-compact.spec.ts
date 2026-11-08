import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preview } from "astro";
import { CONSENT_BANNER_HEIGHT_VAR, CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";

// The banner only renders when a GA4 id is built in, which the default dist
// leaves out. Build one that has it, independently of BASE_URL.
const test = base.extend<{}, { consentURL: string }>({
  consentURL: [async ({}, use) => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const scratch = join(root, "../.scratch");
    await mkdir(scratch, { recursive: true });
    // Astro moves assets by rename, so output must share the source filesystem.
    const outDir = await mkdtemp(join(scratch, "consent-compact-"));
    let server: Awaited<ReturnType<typeof preview>> | undefined;
    try {
      await promisify(execFile)(process.execPath, ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "production",
          ASTRO_BASE: "",
          BASE_URL: "/",
          PUBLIC_GA4_ID: "G-E2ECONSENT01",
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

test.beforeEach(async ({ context, consentURL }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === consentURL
    ? route.continue()
    : route.abort());
});

const locales = [
  {
    id: "pt",
    quiz: "/pt-br/",
    games: { guess: "/pt-br/adivinhe/", grid: "/pt-br/grid/", connections: "/pt-br/conexoes/" },
    reject: /^Recusar Google Analytics$/,
    accept: /^Aceitar Google Analytics$/,
    purpose: "cookies e identificadores do Google Analytics para estatísticas de audiência",
    policy: /^Política de privacidade$/,
    privacyPath: "/pt-br/privacidade/",
  },
  {
    id: "en",
    quiz: "/en/",
    games: { guess: "/en/guess/", grid: "/en/grid/", connections: "/en/connections/" },
    reject: /^Reject Google Analytics$/,
    accept: /^Accept Google Analytics$/,
    purpose: "Google Analytics cookies and identifiers for audience statistics",
    policy: /^Privacy policy$/,
    privacyPath: "/en/privacy/",
  },
] as const;

const phones = [
  { width: 360, height: 740 },
  { width: 390, height: 664 },
  { width: 390, height: 844 },
] as const;

const boards = {
  guess: ".name-guess-board",
  grid: ".grid-board-table",
  connections: ".connections-grid",
} as const;

/** The tallest phone banner the layout budgets for. */
const PHONE_BANNER_MAX = 130;

async function openWithBanner(page: Page, url: string): Promise<Locator> {
  await page.goto(url);
  const banner = page.locator(".consent-banner");
  await expect(banner, "the consent build must render the real banner").toBeVisible();
  // The island publishes its height once it has laid out.
  await expect.poll(() => page.evaluate((name) => document.documentElement.style.getPropertyValue(name), CONSENT_BANNER_HEIGHT_VAR))
    .toMatch(/px$/);
  return banner;
}

/** Rectangle of the open banner, which must sit flush with the bottom edge. */
async function bannerBox(page: Page) {
  const box = await page.locator(".consent-banner").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, innerHeight: window.innerHeight };
  });
  expect(Math.abs(box.bottom - box.innerHeight)).toBeLessThanOrEqual(1);
  return box;
}

/** Every listed element is inside the viewport, above the banner, and is what a tap at its center hits. */
async function expectReachableAboveBanner(page: Page, selector: string) {
  const results = await page.evaluate((selector) => {
    const banner = document.querySelector(".consent-banner")!.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName,
          top: r.top,
          bottom: r.bottom,
          bannerTop: banner.top,
          hit: hit === el || el.contains(hit),
        };
      });
  }, selector);
  expect(results.length, `${selector} must render at least one control`).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.top, `${result.label} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(result.bottom, `${result.label} ends above the banner`).toBeLessThanOrEqual(result.bannerTop + 0.5);
    expect(result.hit, `${result.label} is not covered`).toBe(true);
  }
}

/** The board's top edge is on screen, above both the action bar and the banner, and is not covered. */
async function expectBoardTopVisible(page: Page, board: string) {
  const geometry = await page.locator(board).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const bar = document.querySelector(".game-actions")?.getBoundingClientRect();
    const banner = document.querySelector(".consent-banner")!.getBoundingClientRect();
    const probe = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
    return {
      top: r.top,
      visibleBottom: Math.min(bar?.top ?? Infinity, banner.top),
      hit: probe !== null && el.contains(probe),
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.top + 8).toBeLessThanOrEqual(geometry.visibleBottom);
  expect(geometry.hit).toBe(true);
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

for (const locale of locales) {
  for (const viewport of phones) {
    test(`consent ${locale.id} ${viewport.width}x${viewport.height}: compact banner leaves Quiz start in view`, async ({ page, consentURL }) => {
      await page.setViewportSize(viewport);
      const banner = await openWithBanner(page, consentURL + locale.quiz);
      const box = await bannerBox(page);
      expect(box.height).toBeLessThanOrEqual(PHONE_BANNER_MAX);

      // The text names both tools and what the optional cookies are for, as the policy does.
      const text = banner.locator(".consent-banner-text");
      await expect(text).toContainText("Cloudflare");
      await expect(text).toContainText(locale.purpose);
      await expect(banner.getByRole("link", { name: locale.policy })).toHaveAttribute("href", locale.privacyPath);

      // Reject and Accept share a row with the same size and style.
      const reject = (await banner.getByRole("button", { name: locale.reject }).boundingBox())!;
      const accept = (await banner.getByRole("button", { name: locale.accept }).boundingBox())!;
      expect(Math.abs(reject.y - accept.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(reject.height - accept.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(reject.width - accept.width)).toBeLessThanOrEqual(1);
      expect(reject.height).toBeGreaterThanOrEqual(44);
      expect(reject.x + reject.width).toBeLessThanOrEqual(accept.x);
      expect(await banner.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.className)))
        .toEqual(Array(2).fill(await banner.getByRole("button").first().getAttribute("class")));
      await expectNoHorizontalOverflow(page);

      // The start button and the rest of the setup bar stay above the banner.
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      await expectReachableAboveBanner(page, "[data-testid=game-start]");
      await expectReachableAboveBanner(page, ".setup-actions button");
    });
  }

  test(`consent ${locale.id} 360x740: boards start in view and their bars stay above the banner`, async ({ page, consentURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const game of ["guess", "grid", "connections"] as const) {
      await openWithBanner(page, consentURL + locale.games[game]);
      await expect(page.locator(boards[game])).toBeVisible({ timeout: 30_000 });
      expect((await bannerBox(page)).height).toBeLessThanOrEqual(PHONE_BANNER_MAX);
      await expectBoardTopVisible(page, boards[game]);
      await expectReachableAboveBanner(page, ".game-actions button");
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`consent ${locale.id} 360x740: footer controls scroll clear of the banner`, async ({ page, consentURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openWithBanner(page, consentURL + locale.quiz);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight)).toBe(true);
    await expectReachableAboveBanner(page, "footer a, footer button");
  });

  test(`consent ${locale.id} 360x740: keyboard reaches the banner and Reject closes it`, async ({ page, consentURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const banner = await openWithBanner(page, consentURL + locale.quiz);
    const start = page.getByTestId("game-start");
    await expect(start).toBeEnabled({ timeout: 30_000 });

    // Tab from the start button lands on the banner's controls in reading order.
    await start.focus();
    let reached = false;
    for (let step = 0; step < 40 && !reached; step++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const active = document.activeElement!;
        return {
          label: active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 30) ?? active.tagName,
          inBanner: active.closest(".consent-banner") !== null,
          bottom: active.getBoundingClientRect().bottom,
          bannerTop: document.querySelector(".consent-banner")!.getBoundingClientRect().top,
        };
      });
      reached = focus.inBanner;
      if (!reached) expect(focus.bottom, `${focus.label} is focused above the banner`).toBeLessThanOrEqual(focus.bannerTop + 0.5);
    }
    expect(reached, "Tab must reach the consent banner").toBe(true);
    const rejectButton = banner.getByRole("button", { name: locale.reject });
    while (!(await rejectButton.evaluate((el) => el === document.activeElement))) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest(".consent-banner") !== null)).toBe(true);
    }
    await page.keyboard.press("Enter");

    await expect(banner).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), CONSENT_STORAGE_KEY)).toBe("rejected");
    // Preact runs effect cleanups after paint, so the height clears a frame later.
    await expect.poll(() => page.evaluate((name) => document.documentElement.style.getPropertyValue(name), CONSENT_BANNER_HEIGHT_VAR))
      .toBe("");
    await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
    // Tabbing scrolled to the footer; back at the top the start button is whole again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(start).toBeInViewport({ ratio: 1 });
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }] as const) {
    test(`consent ${locale.id} ${viewport.width}x${viewport.height}: desktop banner keeps one row`, async ({ page, consentURL }) => {
      await page.setViewportSize(viewport);
      const banner = await openWithBanner(page, consentURL + locale.quiz);
      // At most two lines of text beside the buttons.
      const lineHeight = await banner.locator(".consent-banner-text").evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      const text = (await banner.locator(".consent-banner-text").boundingBox())!;
      expect(text.height).toBeLessThanOrEqual(2 * lineHeight + 1);
      const reject = (await banner.getByRole("button", { name: locale.reject }).boundingBox())!;
      expect(reject.y).toBeLessThan(text.y + text.height);
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      await expectReachableAboveBanner(page, "[data-testid=game-start]");
    });
  }
}
