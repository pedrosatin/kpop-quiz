import { verifyDist } from "./csp-policy.mjs";

const argDir = process.argv.indexOf("--dir");
const dist = argDir > -1 ? process.argv[argDir + 1] : "dist";

const errors = verifyDist(dist, { requireMeta: process.argv.includes("--require-meta") });
if (errors.length) {
  console.error(errors.map((error) => `csp-verify: ${error}`).join("\n"));
  process.exit(1);
}
console.log("csp-verify: ok");
