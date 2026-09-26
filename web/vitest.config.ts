import { getViteConfig } from "astro/config";
import { defineConfig, mergeConfig } from "vitest/config";

// Astro's Vite plugins let tests render .astro components with the Astro
// container (see src/tests/game-intro.test.ts).
export default defineConfig(async (env) =>
  mergeConfig(await getViteConfig({})(env), {
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  }),
);
