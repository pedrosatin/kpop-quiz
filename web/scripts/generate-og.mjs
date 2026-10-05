// Regenerates the Open Graph cards in public/og/: one 1200x630 PNG per
// indexable route (ADR 021). Run it after changing a game name, the tagline
// or the card layout, then commit the PNGs:
//   npm run og:generate
// Chromium from the Playwright devDependency renders the card with the
// self-hosted variable fonts (npm run playwright:install fetches it). Names,
// paths and the tagline come from the TypeScript modules the site uses; Node
// strips their types on import.
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { getMessages } from "../src/i18n/catalog.ts";
import {
  SEO_OG_IMAGE_DIR,
  SEO_OG_IMAGE_HEIGHT,
  SEO_OG_IMAGE_WIDTH,
  SEO_OG_TAGLINE,
  SEO_PROD_ORIGIN,
  SEO_ROUTES,
  seoGameName,
  seoOgImagePath,
} from "../src/lib/seo-routes.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(web, "public");
const outDir = join(publicDir, ...SEO_OG_IMAGE_DIR.split("/").filter(Boolean));

function fontDataUrl(relativePath) {
  const bytes = readFileSync(join(publicDir, relativePath));
  return `data:font/woff2;base64,${bytes.toString("base64")}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Light theme colors from src/styles/tokens.css.
const STYLE = `
@font-face {
  font-family: "Space Grotesk";
  src: url(${fontDataUrl("fonts/space-grotesk/SpaceGrotesk-latin-wght.woff2")}) format("woff2");
  font-weight: 300 700;
}
@font-face {
  font-family: "Noto Sans";
  src: url(${fontDataUrl("fonts/noto-sans/NotoSans-latin-wght.woff2")}) format("woff2");
  font-weight: 100 900;
}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${SEO_OG_IMAGE_WIDTH}px; height: ${SEO_OG_IMAGE_HEIGHT}px; overflow: hidden; }
body {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 80px 88px 96px;
  background: #FFF8F0;
  color: #24182B;
  font-family: "Noto Sans", sans-serif;
}
.brand { display: flex; align-items: baseline; gap: 28px; }
.wordmark { font-family: "Space Grotesk"; font-weight: 700; font-size: 64px; letter-spacing: -0.05em; }
.wordmark span { color: #B31555; }
.kicker { font-size: 36px; font-weight: 600; color: #66566D; }
.title {
  margin-top: auto;
  font-family: "Space Grotesk";
  font-weight: 700;
  font-size: 136px;
  line-height: 1;
  letter-spacing: -0.03em;
  white-space: nowrap;
}
.tagline { margin-top: 28px; font-size: 40px; color: #66566D; }
.host { margin-top: auto; font-family: "Space Grotesk"; font-weight: 700; font-size: 36px; color: #B31555; }
.stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 24px; display: flex; }
.stripe i { flex: 1; }
`;

// Connections difficulty colors as the bottom stripe.
const STRIPE = ["#FDE047", "#86EFAC", "#93C5FD", "#D8B4FE"]
  .map((color) => `<i style="background:${color}"></i>`)
  .join("");

function cardHtml({ lang, title, kicker, tagline, host }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<div class="brand"><div class="wordmark"><span>K</span>Q</div>${kicker ? `<div class="kicker">${escapeHtml(kicker)}</div>` : ""}</div>
<h1 class="title">${escapeHtml(title)}</h1>
<p class="tagline">${escapeHtml(tagline)}</p>
<p class="host">${escapeHtml(host)}</p>
<div class="stripe">${STRIPE}</div>
</body></html>`;
}

async function main() {
  const host = new URL(SEO_PROD_ORIGIN).host;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: SEO_OG_IMAGE_WIDTH, height: SEO_OG_IMAGE_HEIGHT },
      deviceScaleFactor: 1,
    });
    for (const route of SEO_ROUTES) {
      const messages = getMessages(route.locale);
      const isSite = route.key === "quiz";
      await page.setContent(
        cardHtml({
          lang: route.locale,
          title: isSite ? "K-pop Quiz" : seoGameName(route.key, messages),
          kicker: isSite ? null : "K-pop Quiz",
          tagline: SEO_OG_TAGLINE[route.locale],
          host,
        }),
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        // Shrink long game names until they fit on one line.
        const title = document.querySelector(".title");
        const room = document.body.clientWidth - 2 * 88;
        let size = parseFloat(getComputedStyle(title).fontSize);
        while (title.scrollWidth > room && size > 48) {
          size -= 4;
          title.style.fontSize = `${size}px`;
        }
      });
      const relative = seoOgImagePath(route.key, route.locale);
      await page.screenshot({
        path: join(publicDir, ...relative.split("/").filter(Boolean)),
        type: "png",
      });
    }
  } finally {
    await browser.close();
  }
  console.log(`generate-og: wrote ${readdirSync(outDir).length} images to public${SEO_OG_IMAGE_DIR}`);
}

await main();
