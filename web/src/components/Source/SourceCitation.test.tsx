import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { getMessages } from "../../i18n/catalog";
import { SourceCitation } from "./SourceCitation";

afterEach(cleanup);

const url = "https://en.wikipedia.org/w/index.php?curid=69853256&oldid=1304966710";
const locator = "wikipedia:en:pageid=69853256:revid=1304966710#extract[94:98]";

describe("SourceCitation", () => {
  it("reads the site, the revision and the place in Portuguese, with the locator kept on the link", () => {
    render(<SourceCitation url={url} revision={1304966710} locator={locator} messages={getMessages("pt-BR")} />);
    expect(screen.getByText("Wikipédia em inglês, revisão 1304966710, no resumo do artigo.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Abrir esta revisão na Wikipédia em inglês" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("title", locator);
    expect(link).toHaveAccessibleDescription(locator);
    expect(link.closest(".source-citation")).toHaveAttribute("data-locator", locator);
    expect(document.body.textContent).not.toContain("pageid=");
  });

  it("reads a Wikidata statement in English", () => {
    const claim = "claims/P569/Q85884933$FA/references/abc";
    render(<SourceCitation url="https://www.wikidata.org/w/index.php?title=Q85884933&oldid=25" revision={25} locator={claim} messages={getMessages("en")} />);
    expect(screen.getByText("Wikidata, revision 25, in the “date of birth” statement.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open this revision on Wikidata" })).toHaveAttribute("title", claim);
  });

  it("shows a safe label for a locator it does not know, and keeps the locator", () => {
    render(<SourceCitation url={url} revision={1} locator="section:History/para=3" messages={getMessages("pt-BR")} />);
    expect(screen.getByText("Wikipédia em inglês, revisão 1, no trecho citado.")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("title", "section:History/para=3");
    expect(screen.queryByText(/section:History/)).not.toBeInTheDocument();
  });

  it("puts extra text between the citation and the link", () => {
    render(
      <SourceCitation url="https://www.wikidata.org/wiki/Q1" revision={9} locator="claims/P264/x" messages={getMessages("pt-BR")}>
        {" Referência citada: jype.com."}
      </SourceCitation>,
    );
    const citation = screen.getByRole("link").closest(".source-citation")!;
    expect(citation).toHaveTextContent("Wikidata, revisão 9, na declaração “gravadora”. Referência citada: jype.com. Abrir esta revisão no Wikidata");
  });

  it("does not link an unsafe URL and names the fallback site instead", () => {
    render(<SourceCitation url="javascript:alert(1)" revision={2} locator="p. 2" fallbackSite="upstream" messages={getMessages("pt-BR")} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("upstream, revisão 2, no trecho citado.")).toHaveAttribute("title", "p. 2");
  });

  it("leaves out a missing revision or locator", () => {
    render(<SourceCitation url={url} revision={null} messages={getMessages("en")} />);
    expect(screen.getByText("English Wikipedia.")).toBeInTheDocument();
    expect(screen.getByRole("link")).not.toHaveAttribute("title");
  });
});
