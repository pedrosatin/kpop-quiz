import type { QuizQuestion } from "../../lib/quiz-types";

export interface DisplayEvidence {
  source_url: string;
  revision_id: number;
  locator: string;
  project: "Wikidata" | "Wikipedia";
  declaredReference: string | null;
}

export function groupEvidence(evidenceItems: QuizQuestion["evidence"]): DisplayEvidence[] {
  const groups = new Map<string, DisplayEvidence>();
  for (const evidence of evidenceItems ?? []) {
    const key = `${evidence.source_url}\u0000${evidence.revision_id}\u0000${evidence.locator}`;
    if (groups.has(key)) continue;
    const wikidata = new URL(evidence.source_url).hostname === "www.wikidata.org";
    groups.set(key, {
      source_url: evidence.source_url,
      revision_id: evidence.revision_id,
      locator: evidence.locator,
      project: wikidata ? "Wikidata" : "Wikipedia",
      declaredReference:
        wikidata && evidence.source_key.startsWith("domain:")
          ? evidence.source_key.slice("domain:".length)
          : null,
    });
  }
  return [...groups.values()];
}
