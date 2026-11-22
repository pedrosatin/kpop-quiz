import { existsSync } from "node:fs";

export const nodeTestGlobs = [
  "src/data/**/*.test.ts",
  "src/i18n/**/*.test.ts",
  "src/styles/**/*.test.ts",
];

export const nodeTestFiles = [
  "src/components/CodeGroups/code-groups-state.test.ts",
  "src/components/CodeGroups/code-groups-text.test.ts",
  "src/components/Feedback/feedback-request.test.ts",
  "src/components/Feedback/feedback-state.test.ts",
  "src/components/Grid/candidate-search.test.ts",
  "src/components/Grid/grid-feedback.test.ts",
  "src/components/MapPilot/map-pilot-geometry.test.ts",
  "src/components/MapPilot/map-pilot-targets.test.ts",
  "src/components/MapPilot/map-pilot-turn.test.ts",
  "src/components/MapPilot/map-pilot-zoom.test.ts",
  "src/components/NameGuess/key-letter.test.ts",
  "src/components/Results/share-text.test.ts",
  "src/components/Timeline/timeline-board-state.test.ts",
  "src/components/Timeline/timeline-game-state.test.ts",
  "src/components/WordSearch/word-search-match.test.ts",
  "src/components/WordSearch/word-search-state.test.ts",
  "src/components/WordSearch/word-search-view.test.ts",
  "src/lib/display-name.test.ts",
  "src/lib/format-date.test.ts",
  "src/lib/guards.test.ts",
  "src/lib/https-url.test.ts",
  "src/lib/join-base-url.test.ts",
  "src/lib/quiz-types.test.ts",
  "src/lib/seo-routes.test.ts",
  "src/lib/sitemap.test.ts",
  "src/lib/source-label.test.ts",
  "src/lib/visible-names-contract.test.ts",
  "src/tests/analytics-beacon.test.ts",
  "src/tests/csp-policy.test.ts",
  "src/tests/e2e-shards.test.ts",
  "src/tests/ga4-consent.test.ts",
  "src/tests/game-about.test.ts",
  "src/tests/game-intro.test.ts",
  "src/tests/game-layout.test.ts",
  "src/tests/llms.test.ts",
  "src/tests/not-found-page.test.ts",
  "src/tests/pairwise.test.ts",
  "src/tests/platform-overview.test.ts",
  "src/tests/privacy-notice.test.ts",
  "src/tests/published-artifacts.test.ts",
  "src/tests/published-schemas.test.ts",
  "src/tests/quiz-layout.test.ts",
  "src/tests/redirects.test.ts",
  "src/tests/robots.test.ts",
];

const missing = nodeTestFiles.filter((file) => !existsSync(file));
if (missing.length > 0) {
  throw new Error(`vitest.node-tests.ts lists files that do not exist: ${missing.join(", ")}`);
}
