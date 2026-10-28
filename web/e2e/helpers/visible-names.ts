/**
 * What a player should read on screen for a published label, written
 * independently of src/lib/display-name so the specs check the contract
 * instead of echoing the implementation.
 *
 * Contract: a trailing Wikipedia note ("Tempest (grupo)") is hidden when the
 * short form stays unique among the labels shown together; nothing else
 * changes spelling, except reviewed per-entity overrides listed here by hand.
 * Only the notes the README documents count as Wikipedia notes. Any other
 * trailing parenthetical, such as "(duo)" or "(álbum de Aespa)", is part of
 * the label and stays. `src/lib/visible-names-contract.test.ts` runs this
 * file and the product over every published label so the two cannot drift.
 */

/** Reviewed spellings, by "<qid>:<locale>", each backed by cited evidence. */
const REVIEWED: Record<string, { published: string; visible: string }> = {
  "Q269836:pt-BR": { published: "shinee", visible: "SHINee" },
};

/** The Wikipedia notes the README documents, spelled out, not matched by shape. */
const WIKIPEDIA_NOTES = [
  "grupo",
  "grupo musical",
  "grupo sul-coreano",
  "grupo musical sul-coreano",
  "banda",
  "group",
  "musical group",
  "band",
  "girl group",
  "boy band",
  "south korean band",
  "south korean group",
];

const TRAILING_NOTE = new RegExp(`\\s+\\((?:${WIKIPEDIA_NOTES.join("|")})\\)$`, "i");

export interface PublishedName {
  id: string;
  canonical_name: string;
  labels: Record<string, string>;
}

export function visibleLabels(
  items: readonly PublishedName[],
  locale: "pt-BR" | "en",
): Map<string, string> {
  const raw = items.map((item) => item.labels[locale] || item.canonical_name);
  const short = raw.map((label) => label.replace(TRAILING_NOTE, ""));
  const taken = new Map<string, number>();
  for (const label of short) {
    const key = label.toLowerCase();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const visible = new Map<string, string>();
  items.forEach((item, index) => {
    let label = taken.get(short[index]!.toLowerCase())! > 1 ? raw[index]! : short[index]!;
    const reviewed = REVIEWED[`${item.id}:${locale}`];
    if (reviewed && reviewed.published === label) label = reviewed.visible;
    visible.set(item.id, label);
  });
  return visible;
}

/**
 * A label shown without peers (the Name Guess answer): no note is hidden,
 * because nothing proves the short form unique. Only a reviewed spelling applies.
 */
export function aloneLabel(item: PublishedName, locale: "pt-BR" | "en"): string {
  const label = item.labels[locale] || item.canonical_name;
  const reviewed = REVIEWED[`${item.id}:${locale}`];
  return reviewed && reviewed.published === label ? reviewed.visible : label;
}

/** The note a published label carries, or null; used to prove it is hidden. */
export function hiddenNote(label: string): string | null {
  return TRAILING_NOTE.exec(label)?.[0].trim() ?? null;
}
