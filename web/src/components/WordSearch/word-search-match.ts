import type { WordSearchWord } from "../../lib/word-search-types";
import type { CellCoord } from "./types";
import type { Locale } from "../../lib/quiz-types";
import { sameCell } from "./geometry";
import { getLinearPath } from "./utils";

/** Shorter names would match too many stray letters on the grid. */
const MIN_NAME_LENGTH = 3;

/** Keeps the letters of a name, without accents and in upper case, as names appear on the grid. */
export function normalizeWord(name: string): string {
  return name
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function addNormalized(names: Set<string>, text: string): void {
  const normalized = normalizeWord(text);
  if (normalized.length >= MIN_NAME_LENGTH) names.add(normalized);
}

/**
 * The names a selection may spell to find the word: the word on the grid,
 * then each published name (canonical, in the page's language, in pt-BR and
 * in en) as a whole, by its last token and by everything after its first
 * token. Only names that fit inside the word on the grid count.
 */
export function acceptedNames(word: WordSearchWord, locale: Locale): string[] {
  const names = new Set<string>([word.word]);
  const published = [
    word.canonical_name,
    word.labels?.[locale],
    word.labels?.["pt-BR"],
    word.labels?.["en"],
  ].filter(Boolean) as string[];

  for (const name of published) {
    addNormalized(names, name);
    const tokens = name.trim().split(/[\s-]+/);
    if (tokens.length < 2) continue;
    addNormalized(names, tokens[tokens.length - 1]!);
    addNormalized(names, tokens.slice(1).join(""));
  }

  return [...names].filter((name) => name.length >= MIN_NAME_LENGTH && name.length <= word.word.length);
}

/** Every index where `name` starts inside `text`, overlapping ones included. */
export function occurrences(text: string, name: string): number[] {
  const found: number[] = [];
  for (let index = text.indexOf(name); index !== -1; index = text.indexOf(name, index + 1)) found.push(index);
  return found;
}

/** The selection runs from `from` to `to`, in either direction, and its letters read `name` that way. */
function spells(
  start: CellCoord,
  end: CellCoord,
  from: CellCoord,
  to: CellCoord,
  letters: string,
  revLetters: string,
  name: string,
): boolean {
  const forward = sameCell(start, from) && sameCell(end, to) && letters === name;
  const backward = sameCell(start, to) && sameCell(end, from) && revLetters === name;
  return forward || backward;
}

/**
 * Whether a straight selection, read as `letters` from start to end and as
 * `revLetters` back, finds the word: it covers the whole word, or one of its
 * accepted names where that name sits inside the word on the grid.
 */
export function isWordMatch(
  word: WordSearchWord,
  start: CellCoord,
  end: CellCoord,
  letters: string,
  revLetters: string,
  locale: Locale
): boolean {
  const wordStart = { row: word.start_row, col: word.start_col };
  const wordEnd = { row: word.end_row, col: word.end_col };
  const fullWordPath = getLinearPath(wordStart, wordEnd);
  const selects = (from: CellCoord, to: CellCoord, name: string) =>
    spells(start, end, from, to, letters, revLetters, name);
  const selectsPiece = (name: string, index: number) => {
    const from = fullWordPath[index];
    const to = fullWordPath[index + name.length - 1];
    return from !== undefined && to !== undefined && selects(from, to, name);
  };

  return acceptedNames(word, locale).some((name) =>
    (name === word.word && selects(wordStart, wordEnd, name))
    || occurrences(word.word, name).some((index) => selectsPiece(name, index)));
}
