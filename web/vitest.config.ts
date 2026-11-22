import { getViteConfig } from "astro/config";
import { defineConfig, mergeConfig } from "vitest/config";
import { nodeTestFiles, nodeTestGlobs } from "./vitest.node-tests";

const nodeTests = [...nodeTestGlobs, ...nodeTestFiles];
const exclude = ["**/node_modules/**", "**/dist/**", "**/e2e/**"];

export default defineConfig(async (env) =>
  mergeConfig(await getViteConfig({})(env), {
    test: {
      testTimeout: 20000,
      projects: [
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            include: nodeTests,
            exclude,
          },
        },
        {
          extends: true,
          test: {
            name: "jsdom",
            environment: "jsdom",
            setupFiles: ["./src/test/setup.ts"],
            include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
            exclude: [...exclude, ...nodeTests],
          },
        },
      ],
    },
  }),
);
