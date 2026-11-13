/**
 * Turns a published evidence item (revision URL and locator) into what a
 * player reads: the site and its language, and the place in the page. The
 * raw locator stays the proof; callers keep it in an attribute next to the
 * readable label, never in its place.
 */

export type SourceSite =
  | { kind: "wikipedia"; language: string }
  | { kind: "wikidata" }
  | { kind: "other"; host: string };

export type SourcePlace =
  | { kind: "summary" }
  | { kind: "infobox" }
  | { kind: "statement"; property: string }
  | { kind: "unknown" };

/** The project a cited revision belongs to, read from its URL. */
export type SourceProject = "Wikipedia" | "Wikidata";

export interface SourceTarget {
  href: string;
  site: SourceSite;
}

const WIKIPEDIA_HOST = /^([a-z]{2,3}(?:-[a-z]+)?)\.(?:m\.)?wikipedia\.org$/;
const WIKIDATA_HOSTS = new Set(["www.wikidata.org", "wikidata.org", "m.wikidata.org"]);

function siteOf(hostname: string): SourceSite {
  const wikipedia = WIKIPEDIA_HOST.exec(hostname);
  if (wikipedia) return { kind: "wikipedia", language: wikipedia[1]! };
  if (WIKIDATA_HOSTS.has(hostname)) return { kind: "wikidata" };
  return { kind: "other", host: hostname };
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * The link target of a source, or null when the URL is malformed, is not
 * https or carries credentials: such a URL is never linked.
 */
export function sourceTarget(raw: string): SourceTarget | null {
  const url = parseUrl(raw);
  if (!url || url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  return { href: url.href, site: siteOf(url.hostname) };
}

/**
 * The project of a source URL, read even from a URL that is not linked (one
 * that carries credentials, say), so its citation can still name the site.
 * Null when the URL is malformed or names another site.
 */
export function sourceProject(raw: string): SourceProject | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const site = siteOf(url.hostname);
  if (site.kind === "wikipedia") return "Wikipedia";
  if (site.kind === "wikidata") return "Wikidata";
  return null;
}

/**
 * Where the fact sits in the page. Locators come in three published shapes:
 * `wikipedia:<lang>:pageid=…:revid=…#extract[a:b]` (the article summary),
 * `…#wikitext[a:b]` (an infobox item, see ADR-019) and a Wikidata statement,
 * `claims/P569/…` or `claims.P31`. Anything else is an unknown place.
 */
export function sourcePlace(locator: string): SourcePlace {
  const hash = locator.lastIndexOf("#");
  const place = hash >= 0 ? locator.slice(hash + 1) : locator;
  if (/^extract\[\d+:\d+\]$/.test(place)) return { kind: "summary" };
  if (/^wikitext\[\d+:\d+\]$/.test(place)) return { kind: "infobox" };
  const statement = /^claims[/.](P\d+)(?:\/|$)/.exec(place);
  if (statement) return { kind: "statement", property: statement[1]! };
  return { kind: "unknown" };
}
