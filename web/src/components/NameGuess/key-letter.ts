import { normalizeCrosswordText } from "../../data/crossword";

/**
 * The guess letter a physical key types: the key itself from A to Z in either
 * case, the base letter of an accented one (È gives E, ö gives O), and null for
 * anything else. It uses the crossword normalization, so a name loses its
 * accents the same way in both games. Named keys (Enter, Shift, Dead) and
 * symbols with no base letter (ß, digits) give null.
 */
export function guessLetterFromKey(key: string): string | null {
  const letter = normalizeCrosswordText(key);
  return /^[A-Z]$/.test(letter) ? letter : null;
}
