import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Production (Cloudflare Pages) serves the site from the domain root.
// The GitHub Pages staging build sets these variables so URLs carry the repository subdirectory prefix.
const site = process.env.ASTRO_SITE || "https://kpopquiz.online";
const base = process.env.ASTRO_BASE || undefined;

export default defineConfig({
  site,
  base,
  output: "static",
  integrations: [preact()],
});
