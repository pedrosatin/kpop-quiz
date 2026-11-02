import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { timelineEvidenceLink, TimelineEvidenceList } from "./TimelineEvidenceList";

afterEach(cleanup);

describe("timeline evidence links", () => {
  it.each(["javascript:alert(1)", "data:text/html,hello", "//evil.test", "http://example.com", "https://user:pass@example.com", "invalid", "https://"])('rejects unsafe or malformed URL %s', url => {
    expect(timelineEvidenceLink(url, "en")).toBeNull();
  });

  it.each(["pt-BR", "en"] as const)("labels the linked revision and preserves its locator in %s", locale => {
    const url = "https://en.wikipedia.org/w/index.php?curid=123&oldid=456";
    render(<TimelineEvidenceList locale={locale} revisionLabel={locale === "pt-BR" ? "revisão" : "revision"} evidence={[
      { source_key: "wikipedia:en", source_url: url, revision_id: 456, locator: "wikitext[10:20]", fact_base_id: "fact" },
      { source_key: "domain:jype.com", source_url: "https://www.wikidata.org/w/index.php?oldid=789", revision_id: 789, locator: "claims/P569/ref", fact_base_id: "other" },
    ]} />);
    const link = screen.getByRole("link", { name: locale === "pt-BR" ? "Wikipédia em inglês" : "Wikipedia in English" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("wikitext[10:20]")).toBeInTheDocument();
    expect(screen.getByText(`${locale === "pt-BR" ? "revisão" : "revision"} 456`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wikidata" })).toHaveAttribute("href", "https://www.wikidata.org/w/index.php?oldid=789");
  });
});
