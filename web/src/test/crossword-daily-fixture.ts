import { crosswordChecksum, type CrosswordPuzzle } from "../data/crossword";

function dayBefore(referenceDate: string): string {
  const day = new Date(`${referenceDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * A crossword-daily-v1 envelope around a board of the audited pilot, dated
 * referenceDate and sealed with its checksum. The proof and the base identity
 * are placeholders: the page cannot recompute them (only the publisher holds
 * the fact base), so unit and e2e tests can play the pilot board as any day's.
 */
export async function buildCrosswordDaily(
  board: Pick<CrosswordPuzzle, "rows" | "cols" | "entries" | "vocabulary" | "cells" | "audited_group_count">,
  referenceDate: string,
  previousQids: string[] = [],
): Promise<Record<string, unknown>> {
  const envelope: Record<string, unknown> = {
    schema_version: "crossword-daily-v1",
    reference_date: referenceDate,
    seed: "fixture",
    base_id: "0".repeat(64),
    previous: { state: previousQids.length ? "played" : "omitted", date: dayBefore(referenceDate), qids: [...previousQids].sort() },
    limits: { attempts: 200, placement_nodes: 5000, proof_nodes: 10000 },
    status: "ready",
    attempts: 1,
    rejections: {},
    eligible_group_count: board.audited_group_count,
    connected_group_count: board.audited_group_count,
    puzzle: {
      rows: board.rows,
      cols: board.cols,
      entries: board.entries,
      vocabulary: board.vocabulary,
      cells: board.cells,
      audited_group_count: board.audited_group_count,
      proof: { solutions: 1, complete: true, nodes: 1 },
    },
  };
  envelope.dataset_version = await crosswordChecksum(envelope);
  return envelope;
}

/** The same envelope published as omitted: no board passed verification. */
export async function buildOmittedCrosswordDaily(referenceDate: string): Promise<Record<string, unknown>> {
  const envelope: Record<string, unknown> = {
    schema_version: "crossword-daily-v1",
    reference_date: referenceDate,
    seed: "fixture",
    base_id: "0".repeat(64),
    previous: { state: "omitted", date: dayBefore(referenceDate), qids: [] },
    limits: { attempts: 2, placement_nodes: 5000, proof_nodes: 10000 },
    status: "omitted",
    attempts: 2,
    rejections: { placement: 2 },
    eligible_group_count: 0,
    connected_group_count: 0,
    puzzle: null,
  };
  envelope.dataset_version = await crosswordChecksum(envelope);
  return envelope;
}
