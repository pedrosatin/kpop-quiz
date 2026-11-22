import type { Locale } from "./quiz-types";

/**
 * Explicit allowlist of group landing pages. A slug must appear here to be
 * published; unknown paths 404. Reserved game/privacy segments are rejected
 * so a future group cannot collide with `/pt-br/grid/` or `/en/code/`.
 */
export interface GroupPageDefinition {
  slug: string;
  wikidataId: string;
  name: string;
  /** Current members included in the page roster (accepted has_member, no valid_to). */
  currentMemberIds: readonly string[];
  /** Former members listed separately (accepted has_member with valid_to). */
  formerMemberIds: readonly string[];
}

/** Path segments already used by game or privacy routes in either locale. */
export const RESERVED_GROUP_SLUGS: ReadonlySet<string> = new Set([
  "grid",
  "conexoes",
  "connections",
  "adivinhe",
  "guess",
  "caca-palavras",
  "word-search",
  "mapa",
  "map",
  "linha-do-tempo",
  "timeline",
  "codigo",
  "code",
  "cruzadinha",
  "crossword",
  "palavras-conectadas",
  "strands",
  "privacidade",
  "privacy",
]);

export const GROUP_PAGES: readonly GroupPageDefinition[] = [
  {
    slug: "stray-kids",
    wikidataId: "Q46134670",
    name: "Stray Kids",
    currentMemberIds: [
      "Q59670293", // Bang Chan
      "Q59260597", // Lee Know
      "Q61100669", // Changbin
      "Q57601775", // Hyunjin
      "Q60994278", // Han
      "Q61100678", // Felix
      "Q60467634", // Seungmin
      "Q59831589", // I.N
    ],
    formerMemberIds: [
      "Q61100680", // Kim Woo-jin (valid_to 2019-10-28)
    ],
  },
];

for (const page of GROUP_PAGES) {
  if (RESERVED_GROUP_SLUGS.has(page.slug)) {
    throw new Error(`group page slug collides with a reserved route: ${page.slug}`);
  }
}

export type GroupPageKey = `group:${string}`;

export function groupPageKey(slug: string): GroupPageKey {
  return `group:${slug}`;
}

export function isGroupPageKey(value: string): value is GroupPageKey {
  return value.startsWith("group:");
}

export function groupPageBySlug(slug: string): GroupPageDefinition | undefined {
  return GROUP_PAGES.find((page) => page.slug === slug);
}

export function groupPagePath(slug: string, locale: Locale): string {
  const prefix = locale === "pt-BR" ? "/pt-br" : "/en";
  return `${prefix}/${slug}/`;
}

export function groupDataBasePath(slug: string): string {
  return `group-pages/${slug}`;
}
