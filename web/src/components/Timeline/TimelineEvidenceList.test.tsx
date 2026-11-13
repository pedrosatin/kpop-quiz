import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineEvidenceList } from "./TimelineEvidenceList";

afterEach(cleanup);

describe("timeline evidence links", () => {
  it.each(["javascript:alert(1)", "data:text/html,hello", "//evil.test", "http://example.com", "https://user:pass@example.com", "invalid", "https://"])("does not link the unsafe or malformed URL %s", url => {
    render(<TimelineEvidenceList locale="en" evidence={[
      { source_key: "upstream", source_url: url, revision_id: 7, locator: "p. 1", fact_base_id: "fact" },
    ]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("upstream, revision 7, in the cited passage.")).toHaveAttribute("title", "p. 1");
  });

  it.each([
    ["pt-BR", "Wikipédia em inglês, revisão 456, na caixa de informações do artigo.", "Abrir esta revisão na Wikipédia em inglês", "Wikidata, revisão 789, na declaração \"data de nascimento\".", "Abrir esta revisão no Wikidata"],
    ["en", "English Wikipedia, revision 456, in the article infobox.", "Open this revision on English Wikipedia", "Wikidata, revision 789, in the \"date of birth\" statement.", "Open this revision on Wikidata"],
  ] as const)("reads each source in words and keeps its locator on the link in %s", (locale, wikipediaText, wikipediaLink, wikidataText, wikidataLink) => {
    const url = "https://en.wikipedia.org/w/index.php?curid=123&oldid=456";
    const wikitext = "wikipedia:en:pageid=123:revid=456#wikitext[10:20]";
    const claim = "claims/P569/Q1$abc/references/def";
    render(<TimelineEvidenceList locale={locale} evidence={[
      { source_key: "wikipedia:en", source_url: url, revision_id: 456, locator: wikitext, fact_base_id: "fact" },
      { source_key: "domain:jype.com", source_url: "https://www.wikidata.org/w/index.php?oldid=789", revision_id: 789, locator: claim, fact_base_id: "other" },
    ]} />);
    const link = screen.getByRole("link", { name: wikipediaLink });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("title", wikitext);
    expect(screen.getByText(wikipediaText)).toBeInTheDocument();
    expect(screen.getByText(wikidataText)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: wikidataLink })).toHaveAttribute("title", claim);
    expect(document.body.textContent).not.toContain("pageid=");
  });
});
