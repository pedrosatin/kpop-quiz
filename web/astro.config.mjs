import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  site: "https://kpopquiz.online",
  output: "static",
  integrations: [preact()],
});
