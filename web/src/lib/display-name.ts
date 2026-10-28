/**
 * Player-facing labels from published artifact names.
 *
 * Keeps QID identity and answer keys untouched. Aligns casing to the
 * canonical name when the locale label differs only by case, and strips a
 * trailing Wikipedia-style disambiguator when that does not create a homonym
 * among labels shown together.
 */

/** Wikipedia-style notes only; keeps f(x) and other intentional parentheses. */
const TRAILING_DISAMBIG =
  /\s+\((?:grupo(?:\s+musical)?(?:\s+sul-coreano)?|banda|group(?:\s+sul-coreano)?|musical\s+group|band|girl\s+group|boy\s+band|south\s+korean\s+band|south\s+korean\s+group)\)$/i;

export function stripTrailingDisambiguator(name: string): string {
  return name.replace(TRAILING_DISAMBIG, "").trim();
}

export function alignCaseToCanonical(label: string, canonical: string): string {
  if (
    label &&
    canonical &&
    label.toLocaleLowerCase("en-US") === canonical.toLocaleLowerCase("en-US")
  ) {
    return canonical;
  }
  return label;
}

function caseKey(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

export function resolveDisplayLabels(
  entries: ReadonlyArray<{ label?: string | null | undefined; canonical: string }>,
): string[] {
  const raw = entries.map(({ label, canonical }) => (label ?? "").trim() || canonical);
  const stripped = raw.map(stripTrailingDisambiguator);
  const counts = new Map<string, number>();
  for (const value of stripped) {
    const key = caseKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map(({ canonical }, index) => {
    const chosen =
      (counts.get(caseKey(stripped[index]!)) ?? 0) > 1 ? raw[index]! : stripped[index]!;
    return alignCaseToCanonical(chosen, canonical);
  });
}

export function resolveDisplayLabel(label: string | null | undefined, canonical: string): string {
  return resolveDisplayLabels([{ label: label ?? null, canonical }])[0]!;
}

/** Build id → display name for a pool that publishes `names` or `labels`. */
export function buildLocalizedDisplayNames(
  items: ReadonlyArray<{
    id: string;
    canonical_name: string;
    names?: Partial<Record<string, string>>;
    labels?: Partial<Record<string, string>>;
  }>,
  locale: string,
): Map<string, string> {
  const resolved = resolveDisplayLabels(
    items.map((item) => ({
      label: item.names?.[locale] ?? item.labels?.[locale] ?? null,
      canonical: item.canonical_name,
    })),
  );
  const map = new Map<string, string>();
  items.forEach((item, index) => {
    map.set(item.id, resolved[index]!);
  });
  return map;
}
