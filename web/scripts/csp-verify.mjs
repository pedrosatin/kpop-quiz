// CI guard for the Content Security Policy in public/_headers. Zero dependencies.
// Usage: node scripts/csp-verify.mjs [--dir dist] [--require-meta]
// Fails when _headers has no enforcing Content-Security-Policy (a Report-Only
// header blocks nothing), when an inline script in the built HTML has no
// matching sha256 in script-src, or when an external script is served from a
// source the policy does not list. A page with a meta policy must carry the
// meta form of the header policy; --require-meta demands one in every page,
// as in the staging build (ADR 041).
import { verifyDist } from "./csp-policy.mjs";

const argDir = process.argv.indexOf("--dir");
const dist = argDir > -1 ? process.argv[argDir + 1] : "dist";

const errors = verifyDist(dist, { requireMeta: process.argv.includes("--require-meta") });
if (errors.length) {
  console.error(errors.map((error) => `csp-verify: ${error}`).join("\n"));
  process.exit(1);
}
console.log("csp-verify: ok");
