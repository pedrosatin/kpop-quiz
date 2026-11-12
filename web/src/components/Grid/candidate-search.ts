import type { CandidateEntity, Locale } from "../../lib/quiz-types";

/**
 * The form of a name the picker compares: no accents, no case, and only
 * letters and digits, so "Stray-Kids", "stray kids" and "straykids" read
 * the same, as do "(G)I-dle" and "gidle", "f(x)" and "fx". Compatibility
 * forms fold too (full-width "ＢＴＳ" is "bts"). Hangul and other scripts
 * keep their letters.
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** One group with its names already in compared form, built once per pool. */
export interface CandidateSearchEntry {
  candidate: CandidateEntity;
  /** The names the list shows: canonical, page language and display label. */
  shown: string[];
  /** Other published names (the other language, Wikidata aliases), with the spelling to show. */
  aliases: { name: string; key: string }[];
}

export interface CandidateMatch {
  candidate: CandidateEntity;
  /** The alias the search matched, when no shown name did as well. */
  alias: string | null;
  /** 0 whole name, 1 start of a name, 2 inside a name. */
  rank: number;
}

const NO_MATCH = 3;

export function buildCandidateIndex(
  pool: CandidateEntity[],
  locale: Locale,
  displayNames: Map<string, string>,
): CandidateSearchEntry[] {
  return pool.map((candidate) => {
    const shown = uniqueKeys([candidate.canonical_name, candidate.names[locale] || "", displayNames.get(candidate.id) || ""]);
    const seen = new Set(shown);
    const aliases: { name: string; key: string }[] = [];
    for (const name of [...Object.values(candidate.names), ...(candidate.aliases ?? [])]) {
      const key = normalizeSearch(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      aliases.push({ name, key });
    }
    return { candidate, shown, aliases };
  });
}

/**
 * The groups a search finds, whole names first, then names that start with
 * it, then the rest, each tier in pool order. An empty search finds all.
 */
export function searchCandidates(index: CandidateSearchEntry[], query: string): CandidateMatch[] {
  const norm = normalizeSearch(query);
  if (!norm) return index.map(({ candidate }) => ({ candidate, alias: null, rank: NO_MATCH }));
  const matches: CandidateMatch[] = [];
  for (const entry of index) {
    const match = matchEntry(entry, norm);
    if (match) matches.push(match);
  }
  // Array.prototype.sort is stable, so each tier keeps the pool order.
  return matches.sort((a, b) => a.rank - b.rank);
}

function matchEntry({ candidate, shown, aliases }: CandidateSearchEntry, norm: string): CandidateMatch | null {
  let rank = NO_MATCH;
  for (const key of shown) rank = Math.min(rank, keyRank(key, norm));
  let alias: string | null = null;
  for (const entry of aliases) {
    const aliasRank = keyRank(entry.key, norm);
    if (aliasRank < rank) {
      rank = aliasRank;
      alias = entry.name;
    }
  }
  return rank === NO_MATCH ? null : { candidate, alias, rank };
}

function keyRank(key: string, norm: string): number {
  if (key === norm) return 0;
  if (key.startsWith(norm)) return 1;
  return key.includes(norm) ? 2 : NO_MATCH;
}

/**
 * The match a non-empty search names on its own: the only one, the first
 * whose shown name is the whole search, or the one group with an alias that
 * is. -1 when the search names none.
 */
export function namedMatchIndex(matches: CandidateMatch[], query: string): number {
  if (!normalizeSearch(query)) return -1;
  if (matches.length === 1) return 0;
  const shown = matches.findIndex((m) => m.rank === 0 && m.alias === null);
  if (shown >= 0) return shown;
  const byAlias = matches.flatMap((m, i) => (m.rank === 0 ? [i] : []));
  return byAlias.length === 1 ? byAlias[0]! : -1;
}

function uniqueKeys(names: string[]): string[] {
  return [...new Set(names.map(normalizeSearch).filter(Boolean))];
}
