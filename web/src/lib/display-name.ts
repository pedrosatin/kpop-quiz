/**
 * Player-facing labels from published artifact names.
 *
 * Keeps QID identity and answer keys untouched. Strips a trailing
 * Wikipedia-style disambiguator when that does not create a homonym among
 * labels shown together, and applies reviewed per-entity overrides.
 *
 * No casing is inferred: a locale label that differs from `canonical_name`
 * only by case keeps the published spelling, because neither side is a proven
 * authority (`izna` and `tripleS` are correct as published). A spelling changes
 * only through an entry in `display-label-overrides.json` that cites a pinned
 * source revision.
 */

import overrideTable from "../data/display-label-overrides.json" with { type: "json" };
import type { Locale } from "./quiz-types";

interface LabelOverride {
  qid: string;
  locale: string;
  published: string;
  display: string;
}

const OVERRIDES = new Map<string, LabelOverride>(
  (overrideTable.overrides as LabelOverride[]).map((entry) => [
    `${entry.qid}:${entry.locale}`,
    entry,
  ]),
);

/** The reviewed spelling, only while the label still reads as published. */
export function applyDisplayOverride(
  label: string,
  id: string | null | undefined,
  locale: Locale | null | undefined,
): string {
  if (!id || !locale) return label;
  const override = OVERRIDES.get(`${id}:${locale}`);
  return override && override.published === label ? override.display : label;
}

/** Wikipedia-style notes only; keeps f(x) and other intentional parentheses. */
const TRAILING_DISAMBIG =
  /\s+\((?:grupo(?:\s+musical)?(?:\s+sul-coreano)?|banda|group(?:\s+sul-coreano)?|musical\s+group|band|girl\s+group|boy\s+band|south\s+korean\s+band|south\s+korean\s+group)\)$/i;

export function stripTrailingDisambiguator(name: string): string {
  return name.replace(TRAILING_DISAMBIG, "").trim();
}

function caseKey(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

export function resolveDisplayLabels(
  entries: ReadonlyArray<{
    label?: string | null | undefined;
    canonical: string;
    id?: string | undefined;
  }>,
  locale?: Locale,
): string[] {
  const raw = entries.map(({ label, canonical }) => (label ?? "").trim() || canonical);
  const stripped = raw.map(stripTrailingDisambiguator);
  const counts = new Map<string, number>();
  for (const value of stripped) {
    const key = caseKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map(({ id }, index) => {
    const chosen =
      (counts.get(caseKey(stripped[index]!)) ?? 0) > 1 ? raw[index]! : stripped[index]!;
    return applyDisplayOverride(chosen, id, locale);
  });
}

/**
 * A label shown without its peers. Stripping a disambiguator needs the other
 * labels published together, so a lone label never loses its suffix here;
 * only a reviewed override applies.
 */
export function alignLoneLabel(
  label: string | null | undefined,
  canonical: string,
  id?: string,
  locale?: Locale,
): string {
  return applyDisplayOverride((label ?? "").trim() || canonical, id, locale);
}

/** Build id → display name for a pool that publishes `names` or `labels`. */
export function buildLocalizedDisplayNames(
  items: ReadonlyArray<{
    id: string;
    canonical_name: string;
    names?: Partial<Record<Locale, string>>;
    labels?: Partial<Record<Locale, string>>;
  }>,
  locale: Locale,
): Map<string, string> {
  const resolved = resolveDisplayLabels(
    items.map((item) => ({
      label: item.names?.[locale] ?? item.labels?.[locale] ?? null,
      canonical: item.canonical_name,
      id: item.id,
    })),
    locale,
  );
  const map = new Map<string, string>();
  items.forEach((item, index) => {
    map.set(item.id, resolved[index]!);
  });
  return map;
}
