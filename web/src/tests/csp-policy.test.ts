import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  allowsUrl,
  enforcingPolicy,
  pageMetaPolicy,
  scriptSources,
  stagingCsp,
  stagingMetaPolicy,
  verifyDist,
} from "../../scripts/csp-policy.mjs";

// Covers the CSP guard (scripts/csp-verify.mjs), the production policy in
// public/_headers and the staging meta copy (ADR 041).
const WEB = join(import.meta.dirname, "../..");
const HEADERS = readFileSync(join(WEB, "public/_headers"), "utf8");
const VERIFY = join(WEB, "scripts/csp-verify.mjs");
const STAGING_WORKFLOW = readFileSync(join(WEB, "../.github/workflows/staging.yml"), "utf8");

const INLINE = "console.log(1)";
const INLINE_HASH = `'sha256-${createHash("sha256").update(INLINE).digest("base64")}'`;
const POLICY = `default-src 'self'; script-src 'self' ${INLINE_HASH}; object-src 'none'; frame-ancestors 'none'`;
const PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>t</title><script>${INLINE}</script></head><body></body></html>`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function site(headers: string, pages: Record<string, string> = { "index.html": PAGE }): string {
  const dir = mkdtempSync(join(tmpdir(), "csp-policy-"));
  dirs.push(dir);
  writeFileSync(join(dir, "_headers"), headers);
  for (const [name, html] of Object.entries(pages)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), html);
  }
  return dir;
}

function runVerify(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [VERIFY, "--dir", dir, ...args], { encoding: "utf8" });
}

const logger = { info: () => {} };

async function buildWithBase(base: string, dir: string) {
  const integration = stagingCsp();
  await (integration.hooks["astro:config:done"] as any)({ config: { base } });
  await (integration.hooks["astro:build:done"] as any)({ dir: pathToFileURL(`${dir}/`), logger });
}

describe("csp-verify", () => {
  it("passes a site whose inline scripts are hashed in the enforcing policy", () => {
    const result = runVerify(site(`/*\n  Content-Security-Policy: ${POLICY}\n`));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("csp-verify: ok");
  });

  it("fails when _headers has the policy only as Report-Only", () => {
    const result = runVerify(site(`/*\n  Content-Security-Policy-Report-Only: ${POLICY}\n`));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Report-Only");
  });

  it("fails when an inline script is missing from script-src", () => {
    const result = runVerify(site(`/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'\n`));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing from script-src");
  });

  it("fails with --require-meta when a page has no meta policy", () => {
    const result = runVerify(site(`/*\n  Content-Security-Policy: ${POLICY}\n`), "--require-meta");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no Content-Security-Policy meta tag");
  });
});

describe("production policy in public/_headers", () => {
  const sources = scriptSources(enforcingPolicy(HEADERS));

  it("is enforcing", () => {
    expect(HEADERS).toMatch(/^\s*Content-Security-Policy:/m);
    expect(HEADERS).not.toContain("Content-Security-Policy-Report-Only");
  });

  it("admits the gtag.js loader and nothing else from Google Tag Manager", () => {
    expect(allowsUrl(sources, "https://www.googletagmanager.com/gtag/js?id=G-TEST123")).toBe(true);
    expect(allowsUrl(sources, "https://www.googletagmanager.com/gtm.js?id=GTM-TEST")).toBe(false);
    expect(allowsUrl(sources, "https://www.googletagmanager.com/gtag/js/other.js")).toBe(false);
    expect(sources).not.toContain("https://www.googletagmanager.com");
  });

  it("admits the Cloudflare Web Analytics beacon", () => {
    expect(allowsUrl(sources, "https://static.cloudflareinsights.com/beacon.min.js")).toBe(true);
  });
});

describe("allowsUrl", () => {
  it("matches host, wildcard, scheme and path sources as CSP does", () => {
    expect(allowsUrl(["https:"], "https://a.example/x.js")).toBe(true);
    expect(allowsUrl(["https://*.example.com"], "https://cdn.example.com/x.js")).toBe(true);
    expect(allowsUrl(["https://*.example.com"], "https://example.com/x.js")).toBe(false);
    expect(allowsUrl(["https://a.example/lib/"], "https://a.example/lib/x.js")).toBe(true);
    expect(allowsUrl(["https://a.example/lib/"], "https://a.example/other/x.js")).toBe(false);
    expect(allowsUrl(["https://a.example"], "http://a.example/x.js")).toBe(false);
    expect(allowsUrl(["'self'"], "https://a.example/x.js")).toBe(false);
  });
});

describe("staging meta policy", () => {
  it("copies the header policy without frame-ancestors and the analytics hosts", () => {
    const policy = enforcingPolicy(HEADERS);
    const meta = stagingMetaPolicy(policy);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(meta).not.toContain("frame-ancestors");
    const withoutAnalytics = policy
      .replace(/;\s*frame-ancestors 'none'/, "")
      .replace(/ https:\/\/(?:[\w*-]+\.)*(?:cloudflareinsights\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com)[^\s;]*/g, "");
    expect(meta).toBe(withoutAnalytics);
    expect(meta).toContain("script-src 'self' 'sha256-");
    expect(meta).toContain("connect-src 'self' https://tbbc.app;");
  });

  it("passes the staging workflow guard against analytics hosts in the HTML", () => {
    const guard = /grep -RqE "([^"]+)" --include='\*\.html'/.exec(STAGING_WORKFLOW)?.[1];
    expect(guard).toBeDefined();
    expect(stagingMetaPolicy(enforcingPolicy(HEADERS))).not.toMatch(new RegExp(guard!));
    expect(enforcingPolicy(HEADERS)).toMatch(new RegExp(guard!));
  });

  it("writes out 'none' for a directive left without sources", () => {
    expect(stagingMetaPolicy("script-src https://www.googletagmanager.com/gtag/js; object-src 'none'"))
      .toBe("script-src 'none'; object-src 'none'");
  });

  it("adds the meta policy before every script in a build with a base path", async () => {
    const dir = site(`/*\n  Content-Security-Policy: ${POLICY}\n`, { "index.html": PAGE, "en/index.html": PAGE });
    await buildWithBase("/kpop-quiz/", dir);
    for (const page of ["index.html", "en/index.html"]) {
      const html = readFileSync(join(dir, page), "utf8");
      expect(pageMetaPolicy(html)).toBe(stagingMetaPolicy(POLICY));
      expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf("<script"));
      expect(html.indexOf("<meta charset")).toBeLessThan(html.indexOf('http-equiv="Content-Security-Policy"'));
    }
    expect(verifyDist(dir, { requireMeta: true })).toEqual([]);
  });

  it("leaves the production build, served from the root, untouched", async () => {
    const dir = site(`/*\n  Content-Security-Policy: ${POLICY}\n`);
    await buildWithBase("/", dir);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(PAGE);
  });

  it("fails the staging build when the policy would block one of its scripts", async () => {
    const dir = site(`/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'\n`);
    await expect(buildWithBase("/kpop-quiz", dir)).rejects.toThrow(/missing from script-src/);
  });

  it("rejects a meta policy that differs from _headers or follows a script", () => {
    const stale = PAGE.replace('<meta charset="UTF-8">', `<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src *">`);
    const late = PAGE.replace("</head>", `<meta http-equiv="Content-Security-Policy" content="${stagingMetaPolicy(POLICY)}"></head>`);
    const dir = site(`/*\n  Content-Security-Policy: ${POLICY}\n`, { "stale.html": stale, "late.html": late });
    const errors = verifyDist(dir);
    expect(errors.some((error: string) => error.includes("stale.html") && error.includes("differs from _headers"))).toBe(true);
    expect(errors.some((error: string) => error.includes("late.html") && error.includes("before the Content-Security-Policy meta tag"))).toBe(true);
  });
});
