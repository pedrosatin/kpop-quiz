import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import { stagingCsp } from "./scripts/csp-policy.mjs";

// Production (Cloudflare Pages) serves the site from the domain root.
// The GitHub Pages staging build sets these variables so URLs carry the repository subdirectory prefix.
const site = process.env.ASTRO_SITE || "https://kpopquiz.online";
const base = process.env.ASTRO_BASE || undefined;

export default defineConfig({
  site,
  base,
  output: "static",
  // stagingCsp copies the _headers policy into a meta tag when base is set (ADR 041).
  integrations: [preact(), stagingCsp()],
});
