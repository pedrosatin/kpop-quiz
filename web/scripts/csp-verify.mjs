// CI guard for the Content Security Policy in public/_headers. Zero dependencies.
// Usage: node scripts/csp-verify.mjs [--dir dist]
// Fails when an inline script in the built HTML has no matching sha256 in
// script-src, or when an external script is served from an origin the policy
// does not list. Accepts the enforcing and the Report-Only header.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const argDir = process.argv.indexOf("--dir");
const dist = argDir > -1 ? process.argv[argDir + 1] : "dist";

const headers = readFileSync(join(dist, "_headers"), "utf8");
const cspLine = headers
  .split("\n")
  .find((line) => /^\s*Content-Security-Policy(-Report-Only)?:/.test(line));
if (!cspLine) {
  console.error("csp-verify: no Content-Security-Policy in _headers");
  process.exit(1);
}
const directives = new Map(
  cspLine
    .replace(/^\s*Content-Security-Policy(-Report-Only)?:/, "")
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .filter((tokens) => tokens[0])
    .map(([name, ...values]) => [name, values]),
);
const scriptSrc = directives.get("script-src") ?? directives.get("default-src") ?? [];

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (entry.endsWith(".html")) yield path;
  }
}

const errors = [];
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [, attrs, body] = match;
    const src = /\ssrc="([^"]+)"/.exec(attrs)?.[1];
    if (src) {
      if (/^https?:\/\//.test(src) && !scriptSrc.includes(new URL(src).origin)) {
        errors.push(`${file}: external script ${src} is not allowed by script-src`);
      }
      continue;
    }
    if (/type="application\/ld\+json"/.test(attrs) || !body.trim()) continue;
    const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
    if (!scriptSrc.includes(hash)) errors.push(`${file}: inline script ${hash} is missing from script-src`);
  }
}

if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("csp-verify: ok");
