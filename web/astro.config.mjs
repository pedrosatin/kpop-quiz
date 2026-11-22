import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import { stagingCsp } from "./scripts/csp-policy.mjs";

const site = process.env.ASTRO_SITE || "https://kpopquiz.online";
const base = process.env.ASTRO_BASE || undefined;

export default defineConfig({
  site,
  base,
  output: "static",
  build: { inlineStylesheets: "always" },
  integrations: [preact(), stagingCsp()],
});
