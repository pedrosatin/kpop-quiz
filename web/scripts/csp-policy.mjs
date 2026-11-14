// Content Security Policy helpers shared by csp-verify.mjs and the staging
// build (astro.config.mjs). Zero dependencies.
//
// Production gets the policy from the Content-Security-Policy header in
// public/_headers (Cloudflare Pages). GitHub Pages, which serves staging,
// ignores _headers, so the staging build copies the same policy into a
// <meta http-equiv> tag in every page (ADR 041). The copy drops two things:
// - frame-ancestors, report-uri, report-to and sandbox, which browsers
//   ignore in a meta policy;
// - the analytics hosts. Staging never loads analytics (ADR 017), and the
//   staging workflow fails when a page names one of them.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENFORCING = /^\s*Content-Security-Policy:\s*(.*)$/;
const REPORT_ONLY = /^\s*Content-Security-Policy-Report-Only:\s*(.*)$/;
const META_UNSUPPORTED = new Set(["frame-ancestors", "report-uri", "report-to", "sandbox"]);
const ANALYTICS_HOSTS = ["cloudflareinsights.com", "googletagmanager.com", "google-analytics.com", "analytics.google.com"];
const META_TAG = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i;
const CHARSET_TAG = /<meta\s+charset="[^"]*"\s*\/?>/i;

/**
 * The policies _headers sends, as raw header values.
 * @param {string} headers text of a Cloudflare Pages _headers file
 * @returns {{ enforcing: string | null, reportOnly: string | null }}
 */
export function readHeaderPolicies(headers) {
  let enforcing = null;
  let reportOnly = null;
  for (const line of headers.split("\n")) {
    enforcing ??= ENFORCING.exec(line)?.[1]?.trim() ?? null;
    reportOnly ??= REPORT_ONLY.exec(line)?.[1]?.trim() ?? null;
  }
  return { enforcing, reportOnly };
}

/**
 * The enforcing policy in _headers. A Report-Only policy only reports
 * violations and blocks nothing, so it does not count.
 * @param {string} headers
 * @returns {string}
 */
export function enforcingPolicy(headers) {
  const { enforcing, reportOnly } = readHeaderPolicies(headers);
  if (enforcing) return enforcing;
  if (reportOnly) {
    throw new Error("_headers sends only Content-Security-Policy-Report-Only, which blocks nothing; send Content-Security-Policy");
  }
  throw new Error("no Content-Security-Policy in _headers");
}

/**
 * @param {string} policy
 * @returns {Map<string, string[]>} directive name to its source list
 */
export function parseDirectives(policy) {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name, ...values]) => [name.toLowerCase(), values]),
  );
}

/**
 * The sources that govern scripts: script-src, else default-src.
 * @param {string} policy
 * @returns {string[]}
 */
export function scriptSources(policy) {
  const directives = parseDirectives(policy);
  return directives.get("script-src") ?? directives.get("default-src") ?? [];
}

function isAnalyticsSource(source) {
  const host = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\*\.)?([^/:]+)/i.exec(source)?.[1]?.toLowerCase();
  return Boolean(host) && !source.startsWith("'")
    && ANALYTICS_HOSTS.some((analytics) => host === analytics || host.endsWith(`.${analytics}`));
}

/**
 * The header policy as the staging meta tag carries it: without the
 * directives a meta policy cannot carry and without the analytics sources.
 * A directive left with no source becomes 'none', which is what an empty
 * list means, written out.
 * @param {string} policy
 * @returns {string}
 */
export function stagingMetaPolicy(policy) {
  const parts = [];
  for (const [name, sources] of parseDirectives(policy)) {
    if (META_UNSUPPORTED.has(name)) continue;
    const kept = sources.filter((source) => !isAnalyticsSource(source));
    parts.push([name, ...(kept.length ? kept : ["'none'"])].join(" "));
  }
  return parts.join("; ");
}

/**
 * Whether a source list admits an absolute URL. Covers the forms this site
 * uses: scheme-only (`https:`) and host sources with an optional `*.`
 * wildcard, port and path. A path ending in `/` matches as a prefix, any
 * other path must match exactly, and the query string never counts (CSP
 * Level 3, "Does url match expression").
 * @param {string[]} sources
 * @param {string} raw
 * @returns {boolean}
 */
export function allowsUrl(sources, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return sources.some((source) => {
    if (source.startsWith("'")) return false;
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return source.toLowerCase() === url.protocol;
    const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i.exec(source);
    if (!match) return false;
    const [, scheme, wildcard, host, port, path] = match;
    if ((scheme ? `${scheme.toLowerCase()}:` : "https:") !== url.protocol) return false;
    const hostname = host.toLowerCase();
    if (wildcard ? !url.hostname.endsWith(`.${hostname}`) : url.hostname !== hostname) return false;
    if (port && port !== "*" && port !== (url.port || (url.protocol === "https:" ? "443" : "80"))) return false;
    if (!path) return true;
    return path.endsWith("/") ? url.pathname.startsWith(path) : url.pathname === path;
  });
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function unescapeAttribute(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

/**
 * The policy of a page's <meta http-equiv="Content-Security-Policy">, or null.
 * @param {string} html
 * @returns {string | null}
 */
export function pageMetaPolicy(html) {
  const content = META_TAG.exec(html)?.[1];
  return content === undefined ? null : unescapeAttribute(content);
}

/**
 * Puts the meta policy right after <meta charset>, ahead of every script:
 * a meta policy only governs the markup that follows it.
 * @param {string} html
 * @param {string} policy a meta policy (see stagingMetaPolicy)
 * @returns {string}
 */
export function injectMetaPolicy(html, policy) {
  if (META_TAG.test(html)) throw new Error("page already has a Content-Security-Policy meta tag");
  if (!CHARSET_TAG.test(html)) throw new Error("page has no <meta charset> to anchor the policy");
  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`;
  return html.replace(CHARSET_TAG, (charset) => `${charset}${tag}`);
}

/**
 * Script problems in one page under the given script sources.
 * @param {string} html
 * @param {string[]} sources
 * @returns {string[]}
 */
export function scriptViolations(html, sources) {
  const errors = [];
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [, attrs, body] = match;
    const src = /\ssrc="([^"]+)"/.exec(attrs)?.[1];
    if (src) {
      if (/^https?:\/\//.test(src) && !allowsUrl(sources, src)) {
        errors.push(`external script ${src} is not allowed by script-src`);
      }
      continue;
    }
    if (/type="application\/ld\+json"/.test(attrs) || !body.trim()) continue;
    const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
    if (!sources.includes(hash)) errors.push(`inline script ${hash} is missing from script-src`);
  }
  return errors;
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (entry.endsWith(".html")) yield path;
  }
}

/**
 * Checks a built site against the policy in its _headers. Every inline
 * script needs its hash in script-src and every external script an allowed
 * source. A page that carries a meta policy must carry exactly the staging
 * form of the header policy (stagingMetaPolicy), before its first script.
 * With requireMeta, every page must carry it (the staging build).
 * @param {string} dist
 * @param {{ requireMeta?: boolean }} [options]
 * @returns {string[]} errors, empty when the site passes
 */
export function verifyDist(dist, { requireMeta = false } = {}) {
  let policy;
  try {
    policy = enforcingPolicy(readFileSync(join(dist, "_headers"), "utf8"));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const sources = scriptSources(policy);
  const expectedMeta = stagingMetaPolicy(policy);
  const errors = [];
  for (const file of htmlFiles(dist)) {
    const html = readFileSync(file, "utf8");
    for (const error of scriptViolations(html, sources)) errors.push(`${file}: ${error}`);
    const meta = pageMetaPolicy(html);
    if (meta === null) {
      if (requireMeta) errors.push(`${file}: no Content-Security-Policy meta tag`);
      continue;
    }
    if (meta !== expectedMeta) errors.push(`${file}: meta Content-Security-Policy differs from _headers`);
    const script = html.search(/<script[\s>]/);
    if (script !== -1 && script < html.search(META_TAG)) {
      errors.push(`${file}: a script comes before the Content-Security-Policy meta tag`);
    }
  }
  return [...new Set(errors)];
}

/**
 * Astro integration for the staging build. A build served from a base path
 * (ASTRO_BASE, the GitHub Pages staging site, ADR 016) gets the _headers
 * policy as a meta tag in every page, then fails unless the result passes
 * verifyDist. The production build, served from the root, is left alone.
 * @returns {import("astro").AstroIntegration}
 */
export function stagingCsp() {
  let staging = false;
  return {
    name: "kpop-quiz:staging-csp",
    hooks: {
      "astro:config:done": ({ config }) => {
        staging = config.base.replace(/\/$/, "") !== "";
      },
      "astro:build:done": ({ dir, logger }) => {
        if (!staging) return;
        const dist = fileURLToPath(dir);
        const policy = stagingMetaPolicy(enforcingPolicy(readFileSync(join(dist, "_headers"), "utf8")));
        let pages = 0;
        for (const file of htmlFiles(dist)) {
          writeFileSync(file, injectMetaPolicy(readFileSync(file, "utf8"), policy));
          pages += 1;
        }
        const errors = verifyDist(dist, { requireMeta: true });
        if (errors.length) throw new Error(`staging CSP:\n${errors.join("\n")}`);
        logger.info(`Content-Security-Policy meta tag added to ${pages} pages`);
      },
    },
  };
}
