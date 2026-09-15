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

describe("Design Tokens - WCAG 2.2 AA Contrast Ratios", () => {
  describe("Light Theme Tokens", () => {
    const tokens = {
      canvas: "#FFF8F0",
      surface: "#FFFFFF",
      surfaceMuted: "#F7EFF8",
      text: "#24182B",
      textMuted: "#66566D",
      border: "#94879D",
      action: "#B31555",
      actionHover: "#8F1044",
      actionText: "#FFFFFF",
      link: "#006E73",
      focus: "#0067CC",
      successText: "#0E693D",
      successBg: "#E4F5EB",
      errorText: "#A32119",
      errorBg: "#FDEAE7",
    };

    it("ensures normal text against canvas meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.text, tokens.canvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(16.07, 1);
    });

    it("ensures normal text against surface meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.text, tokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(16.93, 1);
    });

    it("ensures normal text against surface-muted meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.text, tokens.surfaceMuted);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(15.04, 1);
    });

    it("ensures muted text against canvas meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.textMuted, tokens.canvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(6.40, 1);
    });

    it("ensures action button text meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.action, tokens.actionText);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(6.66, 1);
    });

    it("ensures action hover state meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.actionHover, tokens.actionText);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(9.03, 1);
    });

    it("ensures links against canvas and surface meet WCAG 2.2 AA (>= 4.5:1)", () => {
      expect(contrastRatio(tokens.link, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.link, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures success message meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.successText, tokens.successBg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(5.97, 1);
    });

    it("ensures error message meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.errorText, tokens.errorBg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(6.49, 1);
    });

    it("ensures border against surface and canvas meets UI component requirement (>= 3.0:1)", () => {
      expect(contrastRatio(tokens.border, tokens.surface)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(tokens.border, tokens.canvas)).toBeGreaterThanOrEqual(3.0);
    });

    it("ensures focus indicator against canvas and surface meets UI requirement (>= 3.0:1)", () => {
      expect(contrastRatio(tokens.focus, tokens.canvas)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(tokens.focus, tokens.surface)).toBeGreaterThanOrEqual(3.0);
    });
  });

  describe("Dark Theme Tokens", () => {
    const tokens = {
      canvas: "#17121C",
      surface: "#251C2C",
      surfaceMuted: "#30263A",
      text: "#FFF7FB",
      textMuted: "#CFC3D5",
      border: "#776A82",
      action: "#FF74AC",
      actionHover: "#FFA7CC",
      actionText: "#25182A",
      link: "#67DAD7",
      focus: "#7CC4FF",
      successText: "#74E3A8",
      successBg: "#123C2A",
      errorText: "#FF9A91",
      errorBg: "#4B201E",
    };

    it("ensures normal text against canvas meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.text, tokens.canvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(17.50, 1);
    });

    it("ensures normal text against surface meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.text, tokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(15.57, 1);
    });

    it("ensures normal text against surface-muted meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.text, tokens.surfaceMuted);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(13.63, 1);
    });

    it("ensures muted text against canvas meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.textMuted, tokens.canvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(10.90, 1);
    });

    it("ensures action button text meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.action, tokens.actionText);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(6.72, 1);
    });

    it("ensures action hover state meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.actionHover, tokens.actionText);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(9.38, 1);
    });

    it("ensures links against canvas and surface meet WCAG 2.2 AA (>= 4.5:1)", () => {
      expect(contrastRatio(tokens.link, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.link, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures success message meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.successText, tokens.successBg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(7.80, 1);
    });

    it("ensures error message meets WCAG 2.2 AA (>= 4.5:1)", () => {
      const ratio = contrastRatio(tokens.errorText, tokens.errorBg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(6.75, 1);
    });

    it("ensures border against surface and canvas meets UI component requirement (>= 3.0:1)", () => {
      expect(contrastRatio(tokens.border, tokens.surface)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(tokens.border, tokens.canvas)).toBeGreaterThanOrEqual(3.0);
    });

    it("ensures focus indicator against canvas and surface meets UI requirement (>= 3.0:1)", () => {
      expect(contrastRatio(tokens.focus, tokens.canvas)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(tokens.focus, tokens.surface)).toBeGreaterThanOrEqual(3.0);
    });
  });

  describe("Theme Palette Colors", () => {
    it("ensures all light theme accents meet WCAG 2.2 AA with designated text colors", () => {
      // Rosa
      expect(contrastRatio("#B31555", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      // Violeta
      expect(contrastRatio("#6039B2", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      // Ciano
      expect(contrastRatio("#006E73", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      // Amarelo
      expect(contrastRatio("#F5C542", "#24182B")).toBeGreaterThanOrEqual(4.5);
    });

    it("ensures all dark theme accents meet WCAG 2.2 AA with designated text colors", () => {
      // Rosa
      expect(contrastRatio("#FF74AC", "#25182A")).toBeGreaterThanOrEqual(4.5);
      // Violeta
      expect(contrastRatio("#BCA2FF", "#25182A")).toBeGreaterThanOrEqual(4.5);
      // Ciano
      expect(contrastRatio("#67DAD7", "#25182A")).toBeGreaterThanOrEqual(4.5);
      // Amarelo
      expect(contrastRatio("#FFD95A", "#25182A")).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe("Local Font Assets and CSS Declarations", () => {
  const cssPath = path.resolve(__dirname, "global.css");
  const fontsDir = path.resolve(__dirname, "../../public/fonts");

  it("contains valid global.css with no external Google Fonts imports", () => {
    const css = fs.readFileSync(cssPath, "utf-8");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
    expect(css).toContain('@font-face');
    expect(css).toContain('"Space Grotesk"');
    expect(css).toContain('"Noto Sans"');
    expect(css).toContain("font-display: swap");
  });

  it("declares required design token variables in global.css", () => {
    const css = fs.readFileSync(cssPath, "utf-8");
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

  it("supports light, dark, system, forced-colors, and reduced motion in global.css", () => {
    const css = fs.readFileSync(cssPath, "utf-8");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
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
