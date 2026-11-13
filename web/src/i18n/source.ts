import type { Locale } from "../lib/quiz-types";
import type { SourcePlace, SourceProject, SourceSite } from "../lib/source-label";

// Copy for one cited revision, shared by every game's "Ver fonte" panel:
// "Wikipédia em inglês, revisão 123, no resumo do artigo." and a link that
// names where it leads. Property names cover the statements the published
// games cite; another property falls back to its id.

export interface SourceMessages {
  /** The site and its language: "Wikipédia em inglês", "Wikidata". */
  site: (site: SourceSite) => string;
  /** A project without its language, for a URL that is not linked. */
  project: (project: SourceProject) => string;
  revision: (id: number) => string;
  place: (place: SourcePlace) => string;
  /** Text of the link to the cited revision, naming its destination. */
  open: (site: SourceSite) => string;
}

interface SourceCopy {
  languages: Record<string, string>;
  wikipedia: (language: string) => string;
  wikipediaCode: (code: string) => string;
  projects: Record<SourceProject, string>;
  revision: (id: number) => string;
  places: Record<Exclude<SourcePlace["kind"], "statement">, string>;
  properties: Record<string, string>;
  statement: (property: string) => string;
  statementCode: (id: string) => string;
  openWikipedia: (site: string) => string;
  openWikidata: string;
  openOther: (host: string) => string;
}

const copies: Record<Locale, SourceCopy> = {
  "pt-BR": {
    languages: { en: "inglês", ko: "coreano", ja: "japonês", pt: "português", zh: "chinês", es: "espanhol", fr: "francês" },
    wikipedia: (language) => `Wikipédia em ${language}`,
    wikipediaCode: (code) => `Wikipédia (${code})`,
    projects: { Wikipedia: "Wikipédia", Wikidata: "Wikidata" },
    revision: (id) => `revisão ${id}`,
    places: { summary: "no resumo do artigo", infobox: "na caixa de informações do artigo", unknown: "no trecho citado" },
    properties: {
      P31: "tipo de item",
      P175: "intérprete",
      P264: "gravadora",
      P463: "membro de",
      P527: "integrantes",
      P569: "data de nascimento",
      P571: "data de criação",
      P576: "data de dissolução",
      P577: "data de lançamento",
    },
    statement: (property) => `na declaração "${property}"`,
    statementCode: (id) => `na declaração ${id}`,
    openWikipedia: (site) => `Abrir esta revisão na ${site}`,
    openWikidata: "Abrir esta revisão no Wikidata",
    openOther: (host) => `Abrir a fonte em ${host}`,
  },
  en: {
    languages: { en: "English", ko: "Korean", ja: "Japanese", pt: "Portuguese", zh: "Chinese", es: "Spanish", fr: "French" },
    wikipedia: (language) => `${language} Wikipedia`,
    wikipediaCode: (code) => `Wikipedia (${code})`,
    projects: { Wikipedia: "Wikipedia", Wikidata: "Wikidata" },
    revision: (id) => `revision ${id}`,
    places: { summary: "in the article summary", infobox: "in the article infobox", unknown: "in the cited passage" },
    properties: {
      P31: "instance of",
      P175: "performer",
      P264: "record label",
      P463: "member of",
      P527: "members",
      P569: "date of birth",
      P571: "formation date",
      P576: "dissolution date",
      P577: "publication date",
    },
    statement: (property) => `in the "${property}" statement`,
    statementCode: (id) => `in statement ${id}`,
    openWikipedia: (site) => `Open this revision on ${site}`,
    openWikidata: "Open this revision on Wikidata",
    openOther: (host) => `Open the source on ${host}`,
  },
};

function siteLabel(copy: SourceCopy, site: SourceSite): string {
  if (site.kind === "wikidata") return "Wikidata";
  if (site.kind === "other") return site.host;
  const language = copy.languages[site.language];
  return language ? copy.wikipedia(language) : copy.wikipediaCode(site.language);
}

function placeLabel(copy: SourceCopy, place: SourcePlace): string {
  if (place.kind !== "statement") return copy.places[place.kind];
  const name = copy.properties[place.property];
  return name ? copy.statement(name) : copy.statementCode(place.property);
}

function openLabel(copy: SourceCopy, site: SourceSite): string {
  if (site.kind === "wikidata") return copy.openWikidata;
  if (site.kind === "other") return copy.openOther(site.host);
  return copy.openWikipedia(siteLabel(copy, site));
}

function sourceMessages(locale: Locale): SourceMessages {
  const copy = copies[locale];
  return {
    site: (site) => siteLabel(copy, site),
    project: (project) => copy.projects[project],
    revision: copy.revision,
    place: (place) => placeLabel(copy, place),
    open: (site) => openLabel(copy, site),
  };
}

export const sourceCopy: Record<Locale, SourceMessages> = {
  "pt-BR": sourceMessages("pt-BR"),
  en: sourceMessages("en"),
};
