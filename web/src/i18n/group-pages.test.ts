import { describe, expect, it } from "vitest";
import { getGroupPageCopy, groupPageWordCount } from "./group-pages";

describe("group page copy", () => {
  it("keeps at least 300 words of own prose in each locale", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const copy = getGroupPageCopy("stray-kids", locale);
      expect(groupPageWordCount(copy)).toBeGreaterThanOrEqual(300);
      expect(copy.title.toLowerCase()).toContain("k-pop");
      expect(copy.currentMembers).toHaveLength(8);
      expect(copy.formerMembers).toHaveLength(1);
      expect(copy.facts.length).toBeGreaterThanOrEqual(3);
      for (const fact of copy.facts) {
        expect(fact.sourceUrl).toMatch(/^https:\/\//);
        expect(fact.revisionId).toBeGreaterThan(0);
      }
      const publicText = [copy.intro, ...copy.about, copy.quizIntro, copy.wordSearchIntro].join(" ");
      expect(publicText).not.toMatch(/28[\s-]day|28 dias|consulta-alvo|X-Robots-Tag|\/data\/group-pages\/|performed_by|piloto|pilot\b/i);
      expect(copy.about).toHaveLength(4);
      expect(copy.formerMembers[0]?.name).toBe("Kim Woo-jin");
    }
  });
});
