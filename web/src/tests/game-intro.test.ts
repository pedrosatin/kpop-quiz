import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf-8");

// Pages whose game card is 64rem (.game-card--wide, or the map card, which
// takes the whole .page-shell) pass `wide` so the intro shares its left edge.
const GAME_PAGES: Record<string, boolean> = {
  "pages/index.astro": false,
  "pages/pt-br/index.astro": false,
  "pages/en/index.astro": false,
  "pages/pt-br/grid.astro": false,
  "pages/en/grid.astro": false,
  "pages/pt-br/conexoes.astro": false,
  "pages/en/connections.astro": false,
  "pages/pt-br/adivinhe.astro": false,
  "pages/en/guess.astro": false,
  "pages/pt-br/caca-palavras.astro": true,
  "pages/en/word-search.astro": true,
  "pages/pt-br/mapa.astro": true,
  "pages/en/map.astro": true,
};

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (match?.[1] === undefined) throw new Error(`missing rule ${selector}`);
  return match[1];
}

describe("GameIntro page shell", () => {
  it.each(Object.entries(GAME_PAGES))("%s renders one GameIntro and no other h1", (path, wide) => {
    const page = read(path);
    expect(page.match(/<GameIntro\b/g)).toHaveLength(1);
    expect(page).not.toMatch(/<h1\b/);
    const intro = page.slice(page.indexOf("<GameIntro"), page.indexOf("/>", page.indexOf("<GameIntro")));
    expect(/^\s*wide\s*$/m.test(intro)).toBe(wide);
  });

  it("labels the intro with its only h1 and keeps How to play a native disclosure", () => {
    const component = read("components/GameIntro.astro");
    expect(component.match(/<h1\b/g)).toHaveLength(1);
    expect(component).toContain('<h1 id="page-title">');
    expect(component).toContain('aria-labelledby="page-title"');
    expect(component).toMatch(/<details class="how-to-play">\s*<summary/);
    expect(component).toContain('"intro--wide": wide');
  });

  it("gives the intro the width of the card under it, left-aligned", () => {
    const base = read("styles/base.css");
    const components = read("styles/components.css");
    const intro = ruleBody(base, ".intro");
    expect(intro).toContain("max-width: var(--game-max);");
    expect(intro).not.toMatch(/text-align:\s*center/);
    expect(ruleBody(base, ".intro--wide")).toContain("max-width: var(--game-max-wide);");
    expect(ruleBody(components, ".game-card")).toContain("max-width: var(--game-max);");
    expect(ruleBody(components, ".game-card--wide")).toContain("max-width: var(--game-max-wide);");
  });
});
