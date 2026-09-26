// @vitest-environment node
// The Astro container renders .astro files only in the node environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import GameIntro from "../components/GameIntro.astro";

const SRC = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf-8");

// Pages whose game card is 64rem (.game-card--wide, or the map card, which
// takes the whole .page-shell) pass `wide` so the intro shares its left edge.
const GAME_PAGES: Record<string, boolean> = {
  "pages/index.astro": true,
  "pages/pt-br/index.astro": true,
  "pages/en/index.astro": true,
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
    expect(/\bwide(\s|=\{true\}|\/?>)/.test(intro)).toBe(wide);
  });

  it.each([false, true])("renders wide=%s with its only h1 naming the section and How to play before it", async (wide) => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(GameIntro, {
      props: {
        kicker: "Daily game",
        title: "Title",
        intro: "One sentence.",
        howToPlayTitle: "How to play",
        howToPlaySteps: ["First", "Second"],
        wide,
      },
    });
    const doc = new JSDOM(html).window.document;
    const section = doc.querySelector("section.intro")!;
    expect(section.classList.contains("intro--wide")).toBe(wide);
    expect(section.classList.contains("intro--with-help")).toBe(true);
    expect(section.getAttribute("aria-labelledby")).toBe("page-title");
    const headings = doc.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.id).toBe("page-title");
    // DOM order: kicker, the disclosure, then the title and the sentence.
    expect([...section.children].map((node) => node.className || node.tagName)).toEqual([
      "kicker",
      "how-to-play",
      "H1",
      "intro-text",
    ]);
    const details = section.querySelector("details.how-to-play")!;
    expect(details.firstElementChild?.tagName).toBe("SUMMARY");
    expect(details.querySelectorAll("li")).toHaveLength(2);
  });

  it("leaves How to play out when there are no steps", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(GameIntro, {
      props: { kicker: "Daily game", title: "Title", intro: "One sentence." },
    });
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("details")).toBeNull();
    expect(doc.querySelector("section.intro")!.classList.contains("intro--with-help")).toBe(false);
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
