/**
 * Checks shared by the guards that validate published data and local saves.
 * Each answers one question about a value read from JSON.
 */

export const HASH_PATTERN = /^[0-9a-f]{64}$/;
export const QID_PATTERN = /^Q[1-9][0-9]*$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** An object that is not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string that `pattern` matches. */
export function matchesPattern(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

/** A SHA-256 in lowercase hex, the form of every published id and version. */
export function isHash(value: unknown): value is string {
  return matchesPattern(value, HASH_PATTERN);
}

/** A Wikidata item id such as Q42. */
export function isQid(value: unknown): value is string {
  return matchesPattern(value, QID_PATTERN);
}

/** A string with at least one character, even if all of them are whitespace. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A string with at least one character that is not whitespace. */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether the object has every `required` key and no key outside `required`
 * and `optional`. Required keys are tested with `Object.hasOwn`, and extra
 * keys come from `Object.keys`. A value parsed from JSON has only own
 * enumerable keys, so both agree on it.
 */
export function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

/** An integer from `min` to `max`, both included. */
export function isIntegerInRange(value: unknown, min: number, max = Infinity): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * A day of the calendar written YYYY-MM-DD. It refuses the years 0000 to
 * 0099, because Date.UTC reads them as 1900 to 1999 and the day it builds
 * never matches.
 */
export function isIsoDate(value: unknown): value is string {
  if (!matchesPattern(value, ISO_DATE_PATTERN)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

/**
 * A YYYY-MM-DD day that reads back the same through `Date` and
 * `toISOString().slice(0, 10)`. Unlike `isIsoDate`, it accepts the years
 * 0000 to 0099 so historical concert dates round-trip.
 */
export function isLenientIsoDate(value: unknown): value is string {
  if (!matchesPattern(value, ISO_DATE_PATTERN)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/**
 * A list whose every item passes `isItem`, non-empty strings by default. Like
 * `Array.prototype.every`, it skips the holes of a sparse array.
 */
export function isStringList(
  value: unknown,
  isItem: (item: unknown) => item is string = isNonEmptyString,
): value is string[] {
  return Array.isArray(value) && value.every((item) => isItem(item));
}

/** Whether no item appears twice, by SameValueZero as a Set compares. */
export function hasDistinctItems(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}
