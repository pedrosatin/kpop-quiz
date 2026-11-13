import { describe, expect, it } from "vitest";
import { getMessages } from "../i18n/catalog";
import { sourcePlace, sourceProject, sourceTarget, type SourcePlace, type SourceSite } from "./source-label";

const pt = getMessages("pt-BR").source;
const en = getMessages("en").source;

describe("sourceTarget", () => {
  it.each([
    ["https://en.wikipedia.org/w/index.php?curid=1&oldid=2", { kind: "wikipedia", language: "en" }],
    ["https://pt.wikipedia.org/wiki/Red_Velvet", { kind: "wikipedia", language: "pt" }],
    ["https://ko.m.wikipedia.org/wiki/X", { kind: "wikipedia", language: "ko" }],
    ["https://www.wikidata.org/w/index.php?title=Q1&oldid=5", { kind: "wikidata" }],
    ["https://wikidata.org/wiki/Q1", { kind: "wikidata" }],
    ["https://www.ygfamily.com/tour", { kind: "other", host: "www.ygfamily.com" }],
  ] as const)("reads the site of %s", (url, site) => {
    expect(sourceTarget(url)).toEqual({ href: new URL(url).href, site });
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "//evil.test", "http://en.wikipedia.org/wiki/X", "https://user:pass@example.com", "invalid", "https://", ""])(
    "refuses to link %j",
    (url) => {
      expect(sourceTarget(url)).toBeNull();
    },
  );
});

describe("sourceProject", () => {
  it.each([
    ["https://en.wikipedia.org/w/index.php?oldid=2", "Wikipedia"],
    ["https://user:pass@ko.wikipedia.org/wiki/X", "Wikipedia"],
    ["http://www.wikidata.org/wiki/Q1", "Wikidata"],
    ["https://user@www.wikidata.org/wiki/Q1", "Wikidata"],
    ["https://www.ygfamily.com/tour", null],
    ["invalid", null],
  ] as const)("reads the project of %j, linked or not", (url, project) => {
    expect(sourceProject(url)).toBe(project);
  });
});

describe("sourcePlace", () => {
  it.each([
    ["wikipedia:en:pageid=69853256:revid=1304966710#extract[94:98]", { kind: "summary" }],
    ["wikipedia:en:pageid=1:revid=2#wikitext[140:148]", { kind: "infobox" }],
    ["extract[0:4]", { kind: "summary" }],
    ["claims/P569/Q85884933$FA-1/references/abc", { kind: "statement", property: "P569" }],
    ["claims/P571", { kind: "statement", property: "P571" }],
    ["claims.P31", { kind: "statement", property: "P31" }],
    ["GOYANG > GOYANG STADIUM", { kind: "unknown" }],
    ["wikipedia:en:pageid=1:revid=2#section[History]", { kind: "unknown" }],
    ["claimsP31", { kind: "unknown" }],
    ["", { kind: "unknown" }],
  ] as const)("reads %j as a place", (locator, place) => {
    expect(sourcePlace(locator)).toEqual(place);
  });
});

describe("source copy", () => {
  const sites: [SourceSite, string, string, string, string][] = [
    [{ kind: "wikipedia", language: "en" }, "Wikipédia em inglês", "English Wikipedia", "Abrir esta revisão na Wikipédia em inglês", "Open this revision on English Wikipedia"],
    [{ kind: "wikipedia", language: "ko" }, "Wikipédia em coreano", "Korean Wikipedia", "Abrir esta revisão na Wikipédia em coreano", "Open this revision on Korean Wikipedia"],
    [{ kind: "wikipedia", language: "xx" }, "Wikipédia (xx)", "Wikipedia (xx)", "Abrir esta revisão na Wikipédia (xx)", "Open this revision on Wikipedia (xx)"],
    [{ kind: "wikidata" }, "Wikidata", "Wikidata", "Abrir esta revisão no Wikidata", "Open this revision on Wikidata"],
    [{ kind: "other", host: "musicbrainz.org" }, "musicbrainz.org", "musicbrainz.org", "Abrir a fonte em musicbrainz.org", "Open the source on musicbrainz.org"],
  ];

  it.each(sites)("names the site %j and where its link leads", (site, ptSite, enSite, ptOpen, enOpen) => {
    expect(pt.site(site)).toBe(ptSite);
    expect(en.site(site)).toBe(enSite);
    expect(pt.open(site)).toBe(ptOpen);
    expect(en.open(site)).toBe(enOpen);
  });

  const places: [SourcePlace, string, string][] = [
    [{ kind: "summary" }, "no resumo do artigo", "in the article summary"],
    [{ kind: "infobox" }, "na caixa de informações do artigo", "in the article infobox"],
    [{ kind: "statement", property: "P569" }, "na declaração \"data de nascimento\"", "in the \"date of birth\" statement"],
    [{ kind: "statement", property: "P264" }, "na declaração \"gravadora\"", "in the \"record label\" statement"],
    [{ kind: "statement", property: "P9999" }, "na declaração P9999", "in statement P9999"],
    [{ kind: "unknown" }, "no trecho citado", "in the cited passage"],
  ];

  it.each(places)("names the place %j", (place, ptPlace, enPlace) => {
    expect(pt.place(place)).toBe(ptPlace);
    expect(en.place(place)).toBe(enPlace);
  });

  it("names a Wikidata date statement as a date in English", () => {
    expect(en.place({ kind: "statement", property: "P571" })).toBe("in the \"formation date\" statement");
    expect(en.place({ kind: "statement", property: "P576" })).toBe("in the \"dissolution date\" statement");
  });

  it("names a project without its language", () => {
    expect(pt.project("Wikipedia")).toBe("Wikipédia");
    expect(en.project("Wikipedia")).toBe("Wikipedia");
    expect(pt.project("Wikidata")).toBe("Wikidata");
  });

  it("numbers the revision", () => {
    expect(pt.revision(1304966710)).toBe("revisão 1304966710");
    expect(en.revision(1304966710)).toBe("revision 1304966710");
  });
});
