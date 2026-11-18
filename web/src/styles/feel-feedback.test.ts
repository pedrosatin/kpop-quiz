import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const stylesDir = path.resolve(__dirname);
const tokensCss = fs.readFileSync(path.join(stylesDir, "tokens.css"), "utf-8");
const componentsCss = fs.readFileSync(path.join(stylesDir, "components.css"), "utf-8");
const baseCss = fs.readFileSync(path.join(stylesDir, "base.css"), "utf-8");

describe("feel feedback CSS", () => {
  it("declares motion tokens within the ≤250ms budget", () => {
    expect(tokensCss).toContain("--ease-out:");
    expect(tokensCss).toContain("--duration-feedback:");
    expect(tokensCss).toContain("--duration-feedback-result:");
    expect(tokensCss).toMatch(/--duration-feedback:\s*180ms/);
    expect(tokensCss).toMatch(/--duration-feedback-result:\s*220ms/);
  });

  it("defines shared feedback keyframes and data-feedback opt-in selectors", () => {
    for (const name of ["feedback-correct", "feedback-incorrect", "feedback-result"]) {
      expect(componentsCss).toContain(`@keyframes ${name}`);
    }
    expect(componentsCss).toContain('[data-feedback="correct"]');
    expect(componentsCss).toContain('[data-feedback="incorrect"]');
    expect(componentsCss).toContain('[data-feedback="result"]');
    // Motion is opt-in; class-only bars / won-lost colors must not animate.
    expect(componentsCss).not.toMatch(
      /\.game-actions\.is-correct\s*>\s*\.game-actions-message\s*\.game-actions-title/,
    );
    expect(componentsCss).not.toMatch(
      /\.result-title\.is-won[^{]*\{[^}]*animation:\s*feedback-/,
    );
    expect(componentsCss).not.toMatch(/\.btn[^{]*\{[^}]*animation:\s*feedback-/);
  });

  it("keeps reduced-motion kill-switch in base.css at 0.01ms", () => {
    expect(baseCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(baseCss).toContain("animation-duration: 0.01ms !important");
    expect(baseCss).toContain("transition-duration: 0.01ms !important");
  });
});
