// CI guard for Trilha B (SEO + LLM indexing). Zero dependencies.
// Usage: node scripts/seo-verify.mjs [--dir web/dist] [--env prod|staging]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROD_ORIGIN = "https://kpopquiz.online";

const EXPECTED_PATHS = [
  "/pt-br/",
  "/pt-br/grid/",
  "/pt-br/conexoes/",
  "/pt-br/adivinhe/",
  "/pt-br/caca-palavras/",
  "/en/",
  "/en/grid/",
  "/en/connections/",
  "/en/guess/",
  "/en/word-search/",
];

const EXPECTED_LLMS = [
  "pt-br-quiz.md",
  "pt-br-grid.md",
  "pt-br-conexoes.md",
  "pt-br-adivinhe.md",
  "pt-br-caca-palavras.md",
  "en-quiz.md",
  "en-grid.md",
  "en-connections.md",
  "en-guess.md",
  "en-word-search.md",
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

function main() {
  const { dir, env } = parseArgs(process.argv.slice(2));
  const dist = dir;
  check(["prod", "staging"].includes(env), `unknown --env "${env}"`);

  // Sitemap: parseable XML with exactly the 10 canonical prod URLs.
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
    check(locs.length === 10, `sitemap has ${locs.length} <loc> entries, expected 10`);
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
    check(
      html.includes(`property="og:image" content="${PROD_ORIGIN}/apple-touch-icon.png"`),
      `${label} missing absolute og:image`,
    );
    check(html.includes('name="twitter:card"'), `${label} missing twitter:card`);
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

  // Prod keeps noindex only on the redirect stub.
  const rootIndex = join(dist, "index.html");
  if (env === "prod" && existsSync(rootIndex)) {
    const root = readFileSync(rootIndex, "utf-8");
    check(noindexRe.test(root), "dist/index.html (redirect stub) must stay noindex");
  }

  // Defense in depth: _headers ships X-Robots-Tag for /data/*.
  const headersPath = join(dist, "_headers");
  check(existsSync(headersPath), "dist/_headers missing");
  if (existsSync(headersPath)) {
    const headers = readFileSync(headersPath, "utf-8");
    check(headers.includes("/data/*"), "dist/_headers must cover /data/*");
    check(headers.includes("X-Robots-Tag"), "dist/_headers must set X-Robots-Tag");
    check(headers.includes("noindex"), "dist/_headers must set noindex for /data/*");
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
  console.log(`seo:verify OK (${env}): sitemap 10 URLs, robots, head tags, _headers, llms.txt`);
}

main();
