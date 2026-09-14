import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  site: "https://pedrosatin.github.io",
  base: "/kpop-scraping",
  output: "static",
  integrations: [preact()],
});
