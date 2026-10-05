// CI guard for Trilha B (SEO + LLM indexing). Zero dependencies.
// Usage: node scripts/seo-verify.mjs [--dir web/dist] [--env prod|staging]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROD_ORIGIN = "https://kpopquiz.online";
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const EXPECTED_PATHS = [
  "/pt-br/",
  "/pt-br/grid/",
  "/pt-br/conexoes/",
  "/pt-br/adivinhe/",
  "/pt-br/caca-palavras/",
  "/pt-br/mapa/",
  "/pt-br/linha-do-tempo/",
  "/en/",
  "/en/grid/",
  "/en/connections/",
  "/en/guess/",
  "/en/word-search/",
  "/en/map/",
  "/en/timeline/",
];

const EXPECTED_LLMS = [
  "pt-br-quiz.md",
  "pt-br-grid.md",
  "pt-br-conexoes.md",
  "pt-br-adivinhe.md",
  "pt-br-caca-palavras.md",
  "pt-br-mapa.md",
  "pt-br-linha-do-tempo.md",
  "en-quiz.md",
  "en-grid.md",
  "en-connections.md",
  "en-guess.md",
  "en-word-search.md",
  "en-map.md",
  "en-timeline.md",
];

function parseArgs(argv) {
  const args = { dir: "dist", env: "prod" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--env") args.env = argv[++i];
  }
  return args;
}

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

function routeHtmlPaths(dist) {
  return EXPECTED_PATHS.map((routePath) =>
    join(dist, ...routePath.split("/").filter(Boolean), "index.html"),
  );
}

function metaContent(html, attr, name) {
  const tag = html.match(new RegExp(`<meta[^>]*${attr}="${name}"[^>]*>`));
  return tag?.[0].match(/content="([^"]*)"/)?.[1];
}

/** Width and height from the IHDR chunk, or null when the file is not a PNG. */
function pngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.subarray(1, 4).toString("latin1") !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// Large card: absolute og:image on the production host whose file ships in
// this build with the declared 1200x630 size, mirrored in twitter:image.
function checkOgImage(dist, html, label) {
  const image = metaContent(html, "property", "og:image");
  if (!check(image?.startsWith(`${PROD_ORIGIN}/og/`), `${label} og:image must be an absolute ${PROD_ORIGIN}/og/ URL, got ${image}`)) {
    return;
  }
  check(metaContent(html, "name", "twitter:card") === "summary_large_image", `${label} twitter:card must be summary_large_image`);
  check(metaContent(html, "name", "twitter:image") === image, `${label} twitter:image must match og:image`);
  check(metaContent(html, "property", "og:image:width") === String(OG_WIDTH), `${label} og:image:width must be ${OG_WIDTH}`);
  check(metaContent(html, "property", "og:image:height") === String(OG_HEIGHT), `${label} og:image:height must be ${OG_HEIGHT}`);
  check(Boolean(metaContent(html, "property", "og:image:alt")), `${label} missing og:image:alt`);
  // The query is a cache-buster: ?v=<first 8 hex of the PNG's sha256>.
  const [imagePath, query = ""] = image.slice(PROD_ORIGIN.length).split("?");
  const file = join(dist, ...imagePath.split("/").filter(Boolean));
  if (!check(existsSync(file), `${label} og:image ${image} has no file in the build`)) return;
  const version = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
  check(query === `v=${version}`, `${label} og:image ${image} must end in ?v=${version}`);
  const size = pngSize(file);
  check(
    size?.width === OG_WIDTH && size?.height === OG_HEIGHT,
    `${label} og:image ${image} must be a ${OG_WIDTH}x${OG_HEIGHT} PNG, got ${size ? `${size.width}x${size.height}` : "no PNG"}`,
  );
}

function main() {
  const { dir, env } = parseArgs(process.argv.slice(2));
  const dist = dir;
  check(["prod", "staging"].includes(env), `unknown --env "${env}"`);

  // Sitemap: parseable XML with exactly the 14 canonical prod URLs.
  const sitemapCandidates = existsSync(dist)
    ? readdirSync(dist).filter((name) => /^sitemap.*\.xml$/.test(name))
    : [];
  check(
    sitemapCandidates.length === 1,
    `expected exactly one dist/sitemap*.xml, found: ${sitemapCandidates.join(", ") || "(none)"}`,
  );
  if (sitemapCandidates.length === 1) {
    const sitemap = readFileSync(join(dist, sitemapCandidates[0]), "utf-8");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    check(locs.length === EXPECTED_PATHS.length, `sitemap has ${locs.length} <loc> entries, expected ${EXPECTED_PATHS.length}`);
    for (const expected of EXPECTED_PATHS) {
      check(
        locs.includes(`${PROD_ORIGIN}${expected}`),
        `sitemap missing <loc>${PROD_ORIGIN}${expected}</loc>`,
      );
    }
    check(
      locs.every((loc) => !loc.includes("/data/")),
      "sitemap must not reference /data/*",
    );
    const alternates = [...sitemap.matchAll(/<xhtml:link rel="alternate" hreflang="(pt-BR|en)"/g)];
    check(
      alternates.length === locs.length * 2,
      `sitemap has ${alternates.length} xhtml:link alternates, expected ${locs.length * 2}`,
    );
  }

  // Robots: env-aware content.
  const robotsPath = join(dist, "robots.txt");
  check(existsSync(robotsPath), "dist/robots.txt missing");
  if (existsSync(robotsPath)) {
    const robots = readFileSync(robotsPath, "utf-8");
    if (env === "prod") {
      check(robots.includes("Allow: /"), "prod robots.txt must Allow: /");
      check(robots.includes("Disallow: /data/"), "prod robots.txt must Disallow: /data/");
      check(
        robots.includes(`Sitemap: ${PROD_ORIGIN}/sitemap.xml`),
        "prod robots.txt must reference the sitemap",
      );
    } else {
      check(robots.includes("Disallow: /"), "staging robots.txt must Disallow: /");
      check(!robots.includes("Sitemap:"), "staging robots.txt must not reference a sitemap");
    }
  }

  // Route HTML: canonical/hreflang/OG present, noindex policy per env.
  const htmls = routeHtmlPaths(dist);
  for (const htmlPath of htmls) {
    check(existsSync(htmlPath), `${htmlPath} missing`);
  }
  const noindexRe = /<meta[^>]*name="robots"[^>]*content="noindex"[^>]*>/;
  for (const htmlPath of htmls.filter((path) => existsSync(path))) {
    const html = readFileSync(htmlPath, "utf-8");
    const label = htmlPath.replace(dist, "dist");
    check(html.includes('rel="canonical"'), `${label} missing canonical`);
    check(html.includes('hreflang="pt-BR"'), `${label} missing hreflang pt-BR`);
    check(html.includes('hreflang="en"'), `${label} missing hreflang en`);
    check(html.includes('hreflang="x-default"'), `${label} missing hreflang x-default`);
    check(html.includes('property="og:title"'), `${label} missing og:title`);
    checkOgImage(dist, html, label);
    check(
      /<a[^>]*href="[^"]*\/data\//.test(html) === false,
      `${label} links to /data/*`,
    );
    if (env === "prod") {
      check(noindexRe.test(html) === false, `${label} must not be noindex in prod`);
    } else {
      check(noindexRe.test(html), `${label} must be noindex in staging`);
    }
  }

  // The root renders the Portuguese quiz and canonicalizes to /pt-br/.
  const rootIndex = join(dist, "index.html");
  check(existsSync(rootIndex), "dist/index.html missing");
  if (existsSync(rootIndex)) {
    const root = readFileSync(rootIndex, "utf-8");
    check(
      root.includes(`<link rel="canonical" href="${PROD_ORIGIN}/pt-br/"`),
      "dist/index.html must canonicalize to /pt-br/",
    );
    check(root.includes('id="page-title"'), "dist/index.html must render the quiz landing content");
    checkOgImage(dist, root, "dist/index.html");
    check(
      root.includes('application/ld+json'),
      "dist/index.html must contain application/ld+json",
    );
    check(
      noindexRe.test(root) === (env === "staging"),
      `dist/index.html must ${env === "staging" ? "be" : "not be"} noindex in ${env}`,
    );
  }

  // 404 page: Cloudflare Pages (and GitHub Pages) serve dist/404.html with
  // HTTP 404 for unknown paths instead of falling back to the home page.
  const notFound = join(dist, "404.html");
  check(existsSync(notFound), "dist/404.html missing");
  if (existsSync(notFound)) {
    const html = readFileSync(notFound, "utf-8");
    check(noindexRe.test(html), "dist/404.html must be noindex");
    check(!html.includes('rel="canonical"'), "dist/404.html must not declare a canonical URL");
    check(!/<link[^>]*hreflang=/.test(html), "dist/404.html must not declare hreflang alternates");
    check(!html.includes("application/ld+json"), "dist/404.html must not contain application/ld+json");
    check(!html.includes('property="og:url"'), "dist/404.html must not declare og:url");
    check(html.includes('data-testid="not-found"'), "dist/404.html must render the not-found content");
    checkOgImage(dist, html, "dist/404.html");
  }

  // Defense in depth: _headers ships X-Robots-Tag for /data/*.
  const headersPath = join(dist, "_headers");
  check(existsSync(headersPath), "dist/_headers missing");
  if (existsSync(headersPath)) {
    const headers = readFileSync(headersPath, "utf-8");
    check(headers.includes("/data/*"), "dist/_headers must cover /data/*");
    check(headers.includes("X-Robots-Tag"), "dist/_headers must set X-Robots-Tag");
    check(headers.includes("noindex"), "dist/_headers must set noindex for /data/*");
    check(headers.includes("Strict-Transport-Security"), "dist/_headers must set Strict-Transport-Security");
    check(headers.includes("X-Frame-Options"), "dist/_headers must set X-Frame-Options");
  }

  // LLM surface ships in every build.
  check(existsSync(join(dist, "llms.txt")), "dist/llms.txt missing");
  for (const name of EXPECTED_LLMS) {
    check(existsSync(join(dist, "llms", name)), `dist/llms/${name} missing`);
  }
  check(
    !existsSync(join(dist, "llms")) ||
      readdirSync(join(dist, "llms")).every((name) => statSync(join(dist, "llms", name)).isFile()),
    "unexpected entries under dist/llms",
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`seo:verify FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(`seo:verify OK (${env}): root alias, 404 page, sitemap ${EXPECTED_PATHS.length} URLs, robots, head tags, OG cards, _headers, llms.txt`);
}

main();
