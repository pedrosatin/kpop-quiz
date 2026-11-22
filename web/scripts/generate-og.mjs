import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(web, "public");
const tmpDir = join(web, "node_modules", ".cache", "og-generate");

function fontDataUrl(relativePath) {
  const bytes = readFileSync(join(publicDir, relativePath));
  return `data:font/woff2;base64,${bytes.toString("base64")}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const style = (width, height) => `
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
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
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

const STRIPE = ["#FDE047", "#86EFAC", "#93C5FD", "#D8B4FE"]
  .map((color) => `<i style="background:${color}"></i>`)
  .join("");

function cardHtml({ width, height, lang, title, kicker, tagline, host }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${style(width, height)}</style></head><body>
<div class="brand"><div class="wordmark"><span>K</span>Q</div>${kicker ? `<div class="kicker">${escapeHtml(kicker)}</div>` : ""}</div>
<h1 class="title">${escapeHtml(title)}</h1>
<p class="tagline">${escapeHtml(tagline)}</p>
<p class="host">${escapeHtml(host)}</p>
<div class="stripe">${STRIPE}</div>
</body></html>`;
}

async function loadModules() {
  const server = await createServer({
    root: web,
    logLevel: "error",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const catalog = await server.ssrLoadModule("/src/i18n/catalog.ts");
    const seo = await server.ssrLoadModule("/src/lib/seo-routes.ts");
    const groups = await server.ssrLoadModule("/src/lib/group-pages.ts");
    return {
      getMessages: catalog.getMessages,
      seo,
      GROUP_PAGES: groups.GROUP_PAGES,
      isGroupPageKey: groups.isGroupPageKey,
    };
  } finally {
    await server.close();
  }
}

async function main() {
  const { getMessages, seo, GROUP_PAGES, isGroupPageKey } = await loadModules();
  const {
    SEO_OG_IMAGE_DIR,
    SEO_OG_IMAGE_HEIGHT,
    SEO_OG_IMAGE_WIDTH,
    SEO_OG_TAGLINE,
    SEO_PROD_ORIGIN,
    INDEXABLE_SEO_ROUTES,
    seoGameName,
    seoOgImagePath,
    seoRouteDisplayName,
  } = seo;
  const groupNameByKey = new Map(
    GROUP_PAGES.map((page) => [`group:${page.slug}`, page.name]),
  );
  const host = new URL(SEO_PROD_ORIGIN).host;
  const outDir = join(publicDir, ...SEO_OG_IMAGE_DIR.split("/").filter(Boolean));

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: SEO_OG_IMAGE_WIDTH, height: SEO_OG_IMAGE_HEIGHT },
      deviceScaleFactor: 1,
    });
    for (const route of INDEXABLE_SEO_ROUTES) {
      const messages = getMessages(route.locale);
      const isSite = route.key === "quiz";
      const groupName = isGroupPageKey(route.key)
        ? groupNameByKey.get(route.key)
        : undefined;
      const title = isSite
        ? "K-pop Quiz"
        : isGroupPageKey(route.key)
          ? seoRouteDisplayName(route.key, route.locale, messages, groupName)
          : seoGameName(route.key, messages);
      await page.setContent(
        cardHtml({
          width: SEO_OG_IMAGE_WIDTH,
          height: SEO_OG_IMAGE_HEIGHT,
          lang: route.locale,
          title,
          kicker: isSite ? null : "K-pop Quiz",
          tagline: SEO_OG_TAGLINE[route.locale],
          host,
        }),
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
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
        path: join(tmpDir, relative.split("/").pop()),
        type: "png",
      });
    }
  } catch (error) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  } finally {
    await browser.close();
  }
  rmSync(outDir, { recursive: true, force: true });
  renameSync(tmpDir, outDir);
  console.log(`generate-og: wrote ${readdirSync(outDir).length} images to public${SEO_OG_IMAGE_DIR}`);
}

await main();
