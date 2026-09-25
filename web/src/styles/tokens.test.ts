import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const rs = toLinear(r);
  const gs = toLinear(g);
  const bs = toLinear(b);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const tokensCss = fs.readFileSync(path.resolve(__dirname, "tokens.css"), "utf-8");

/** Reads `--name: light-dark(#a, #b)` or `--name: #a` from tokens.css. */
function token(name: string, theme: "light" | "dark"): string {
  const match = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Token --${name} not found`);
  const value = match[1]!.trim();
  const pair = value.match(/^light-dark\((#[0-9A-Fa-f]{6}),\s*(#[0-9A-Fa-f]{6})\)$/);
  if (pair) return theme === "light" ? pair[1]! : pair[2]!;
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value;
  throw new Error(`Token --${name} is not a literal color: ${value}`);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["color-text", "color-canvas"],
  ["color-text", "color-surface"],
  ["color-text", "color-surface-muted"],
  ["color-text-muted", "color-canvas"],
  ["color-text-muted", "color-surface"],
  ["color-text-muted", "color-surface-muted"],
  ["color-action-text", "color-action"],
  ["color-action-text", "color-action-hover"],
  ["color-link", "color-canvas"],
  ["color-link", "color-surface"],
  ["color-success-text", "color-success-bg"],
  ["color-error-text", "color-error-bg"],
  ["color-warning-text", "color-warning-bg"],
  ["color-hit-text", "color-hit"],
  ["color-near-text", "color-near"],
  ["color-miss-text", "color-miss"],
  ["color-hit-hc-text", "color-hit-hc"],
  ["color-near-hc-text", "color-near-hc"],
  ["color-level-1-text", "color-level-1"],
  ["color-level-2-text", "color-level-2"],
  ["color-level-3-text", "color-level-3"],
  ["color-level-4-text", "color-level-4"],
  ...[0, 1, 2, 3, 4, 5].map((i): [string, string] => [`color-found-${i}-text`, `color-found-${i}`]),
];

const UI_PAIRS: Array<[string, string]> = [
  ["color-border", "color-surface"],
  ["color-border", "color-canvas"],
  ["color-focus", "color-surface"],
  ["color-focus", "color-canvas"],
];

describe("Design Tokens - WCAG 2.2 AA Contrast Ratios", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(`${theme} theme`, () => {
      it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (fg, bg) => {
        expect(contrastRatio(token(fg, theme), token(bg, theme))).toBeGreaterThanOrEqual(4.5);
      });

      it.each(UI_PAIRS)("%s against %s meets 3:1", (fg, bg) => {
        expect(contrastRatio(token(fg, theme), token(bg, theme))).toBeGreaterThanOrEqual(3.0);
      });
    });
  }

  it("keeps the documented light palette", () => {
    expect(token("color-canvas", "light")).toBe("#FFF8F0");
    expect(token("color-canvas", "dark")).toBe("#17121C");
    expect(token("color-action", "light")).toBe("#B31555");
  });
});

describe("Local Font Assets and CSS Declarations", () => {
  const cssPath = path.resolve(__dirname, "global.css");
  const fontsDir = path.resolve(__dirname, "../../public/fonts");

  it("contains valid global.css with no external Google Fonts imports", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "base.css"), "utf-8");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
    expect(css).toContain('@font-face');
    expect(css).toContain('"Space Grotesk"');
    expect(css).toContain('"Noto Sans"');
    expect(css).toContain("font-display: swap");
  });

  it("declares required design token variables in tokens.css", () => {
    const css = tokensCss;
    const requiredTokens = [
      "--color-canvas",
      "--color-surface",
      "--color-surface-muted",
      "--color-text",
      "--color-text-muted",
      "--color-border",
      "--color-action",
      "--color-action-hover",
      "--color-link",
      "--color-focus",
      "--color-success-text",
      "--color-success-bg",
      "--color-error-text",
      "--color-error-bg",
      "--color-theme",
      "--space-1",
      "--space-8",
      "--radius-control",
      "--radius-card",
      "--radius-pill",
      "--shadow-card",
      "--shadow-focus",
      "--font-title",
      "--font-body",
    ];
    for (const token of requiredTokens) {
      expect(css).toContain(token);
    }
  });

  it("supports light, dark, system, forced-colors, and reduced motion", () => {
    const base = fs.readFileSync(path.resolve(__dirname, "base.css"), "utf-8");
    // System preference by default, overridable by the theme selector.
    expect(tokensCss).toContain("color-scheme: light dark;");
    expect(tokensCss).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme: light;/);
    expect(tokensCss).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/);
    expect(tokensCss).toContain("@media (forced-colors: active)");
    expect(base).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("imports every stylesheet from the global entry point", () => {
    const css = fs.readFileSync(cssPath, "utf-8");
    for (const file of ["tokens", "base", "components", "stats", "games/quiz", "games/grid", "games/connections", "games/name-guess", "games/word-search"]) {
      expect(css).toContain(`@import "./${file}.css";`);
    }
  });

  it("verifies presence of Space Grotesk WOFF2 and license files", () => {
    const spaceGroteskDir = path.join(fontsDir, "space-grotesk");
    expect(fs.existsSync(path.join(spaceGroteskDir, "SpaceGrotesk[wght].woff2"))).toBe(true);
    expect(fs.statSync(path.join(spaceGroteskDir, "SpaceGrotesk[wght].woff2")).size).toBeGreaterThan(1000);
    expect(fs.existsSync(path.join(spaceGroteskDir, "OFL.txt"))).toBe(true);
    expect(fs.existsSync(path.join(spaceGroteskDir, "AUTHORS.txt"))).toBe(true);
  });

  it("verifies presence of Noto Sans WOFF2 and license files", () => {
    const notoSansDir = path.join(fontsDir, "noto-sans");
    expect(fs.existsSync(path.join(notoSansDir, "NotoSans[wdth,wght].woff2"))).toBe(true);
    expect(fs.statSync(path.join(notoSansDir, "NotoSans[wdth,wght].woff2")).size).toBeGreaterThan(1000);
    expect(fs.existsSync(path.join(notoSansDir, "OFL.txt"))).toBe(true);
    expect(fs.existsSync(path.join(notoSansDir, "AUTHORS.txt"))).toBe(true);
  });
});

describe("Theme Switching and Layout Integration", () => {
  const layoutPath = path.resolve(__dirname, "../layouts/BaseLayout.astro");
  const fontsDir = path.resolve(__dirname, "../../public/fonts");

  it("includes theme-color meta tags for light and dark schemes in BaseLayout", () => {
    const layout = fs.readFileSync(layoutPath, "utf-8");
    expect(layout).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFF8F0" />');
    expect(layout).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17121C" />');
  });

  it("includes storage event listener for kpop-quiz-theme synchronization", () => {
    const layout = fs.readFileSync(layoutPath, "utf-8");
    expect(layout).toContain('window.addEventListener("storage"');
    expect(layout).toContain('"kpop-quiz-theme"');
  });

  it("updates meta theme-color tags dynamically when theme changes", () => {
    const layout = fs.readFileSync(layoutPath, "utf-8");
    expect(layout).toContain("#FFF8F0");
    expect(layout).toContain("#17121C");
    expect(layout).toContain('meta[name="theme-color"]');
  });

  it("formats font README files as markdown tables without unslop patterns", () => {
    const spaceGroteskReadme = fs.readFileSync(path.join(fontsDir, "space-grotesk/README.md"), "utf-8");
    const notoSansReadme = fs.readFileSync(path.join(fontsDir, "noto-sans/README.md"), "utf-8");

    for (const readme of [spaceGroteskReadme, notoSansReadme]) {
      expect(readme).toContain("| Propriedade | Valor |");
      expect(readme).not.toMatch(/^- \*\*/m);
      expect(readme).not.toContain("—");
      expect(readme).not.toContain("–");
    }
  });
});

