import type { TimelineEvent, TimelinePuzzle } from "../../lib/timeline-types";
import type { Locale } from "../../lib/quiz-types";
import type { TimelineDraftState, TimelineStoredState } from "./types";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";

/**
 * Sort events chronologically by date string. Break ties by event ID.
 */
export function getCanonicalChronologicalOrder(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** FNV-1a style seed, matching the map pilot's deterministic RNG. */
function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Fisher–Yates shuffle driven by a linear congruential generator.
 * Same seed and items always yield the same permutation.
 */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const shuffled = [...items];
  let state = hashSeed(seed) || 1;
  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
}

function sameEventIds(left: readonly TimelineEvent[], right: readonly TimelineEvent[]): boolean {
  return left.length === right.length && left.every((event, index) => event.id === right[index]?.id);
}

/**
 * Deterministic initial board order for a daily puzzle identity.
 * Starts from the canonical chronological list so artifact presentation
 * order does not affect the result, then shuffles with the puzzle seed.
 * Guarantees the opening order differs from the solution when there are
 * at least two events.
 */
export function getInitialTimelineOrder(
  events: readonly TimelineEvent[],
  seed: string,
): TimelineEvent[] {
  if (events.length <= 1) return [...events];

  const canonical = getCanonicalChronologicalOrder(events);
  let shuffled = seededShuffle(canonical, seed);

  if (sameEventIds(shuffled, canonical)) {
    shuffled = [...shuffled.slice(1), shuffled[0]!];
  }

  return shuffled;
}

/**
 * Initial event-id sequence for a new timeline match (no saved progress).
 */
export function getInitialTimelineEventIds(puzzle: TimelinePuzzle): string[] {
  return getInitialTimelineOrder(puzzle.events, puzzle.puzzle_id).map((event) => event.id);
}

/**
 * Compare event IDs at each position to canonical order and count total matches.
 */
export function calculateScore(
  currentEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[]
): { score: number; results: boolean[] } {
  const results = currentEvents.map((event, i) => event.id === canonicalEvents[i]?.id);
  const score = results.filter(Boolean).length;
  return { score, results };
}

/**
 * Whether `ids` is a permutation of the puzzle's event ids.
 */
export function isEventOrderOf(ids: unknown, puzzle: TimelinePuzzle): ids is string[] {
  if (!Array.isArray(ids) || ids.length !== puzzle.events.length) return false;
  const puzzleEventIds = new Set(puzzle.events.map((e) => e.id));
  if (ids.some((id: unknown) => typeof id !== "string" || !puzzleEventIds.has(id))) return false;
  return new Set(ids).size === puzzle.events.length;
}

function readStoredObject(storageKey: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Restore the order the player was building before submitting. A draft is the
 * board's save with `submitted: false`; one from another board or date, or with
 * an order that is not a permutation of this board's events, is dropped.
 */
export function loadTimelineDraft(storageKey: string, puzzle: TimelinePuzzle): string[] | null {
  if (!storageKey) return null;
  try {
    const parsed = readStoredObject(storageKey);
    if (!parsed || parsed.submitted !== false) return null;
    if (parsed.puzzleId !== puzzle.puzzle_id || parsed.referenceDate !== puzzle.reference_date) return null;
    return isEventOrderOf(parsed.orderedEventIds, puzzle) ? parsed.orderedEventIds : null;
  } catch {
    return null;
  }
}

/**
 * Persist the order being built. It never records a match: only the submit
 * writes a save with `submitted: true`.
 */
export function saveTimelineDraft(storageKey: string, puzzle: TimelinePuzzle, orderedEventIds: string[]): void {
  const draft: TimelineDraftState = {
    puzzleId: puzzle.puzzle_id,
    referenceDate: puzzle.reference_date,
    orderedEventIds,
    submitted: false,
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Ignore storage quota and permission errors.
  }
}

/**
 * Validate and restore saved timeline game state from localStorage.
 */
export function loadTimelineSavedState(
  storageKey: string,
  puzzle: TimelinePuzzle
): TimelineStoredState | null {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    if (parsed.puzzleId !== puzzle.puzzle_id) return null;
    if (parsed.referenceDate !== puzzle.reference_date) return null;
    if (typeof parsed.submitted !== "boolean") return null;
    if (!parsed.submitted) return null;
    if (parsed.gaveUp !== undefined && typeof parsed.gaveUp !== "boolean") return null;
    if (typeof parsed.score !== "number" || !Number.isInteger(parsed.score) || parsed.score < 0) return null;
    if (!Array.isArray(parsed.results) || !parsed.results.every((r: unknown) => typeof r === "boolean")) {
      return null;
    }
    if (!isEventOrderOf(parsed.orderedEventIds, puzzle)) return null;

    const canonical = getCanonicalChronologicalOrder(puzzle.events);
    const currentEvents = parsed.orderedEventIds.map((id: string) =>
      puzzle.events.find((e) => e.id === id)!
    );
    const evaluated = calculateScore(currentEvents, canonical);
    if (
      parsed.score !== evaluated.score ||
      parsed.results.length !== evaluated.results.length ||
      !parsed.results.every((r: boolean, i: number) => r === evaluated.results[i])
    ) {
      return null;
    }

    return {
      puzzleId: parsed.puzzleId,
      referenceDate: parsed.referenceDate,
      orderedEventIds: parsed.orderedEventIds,
      submitted: parsed.submitted,
      gaveUp: parsed.gaveUp === true,
      score: parsed.score,
      results: parsed.results,
    };
  } catch {
    return null;
  }
}

/**
 * Persist timeline state to localStorage.
 */
export function saveTimelineState(storageKey: string, state: TimelineStoredState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage quota and permission errors.
  }
}

export interface GenerateTimelineShareTextParams {
  gaveUp?: boolean;
  referenceDate: string;
  score: number;
  totalEvents: number;
  results: boolean[];
  locale: Locale;
}

/**
 * Format spoiler-free timeline share text with score, emojis, and URL.
 */
export function generateTimelineShareText({
  referenceDate,
  gaveUp = false,
  score,
  totalEvents,
  results,
  locale,
}: GenerateTimelineShareTextParams): string {
  const isPt = locale === "pt-BR";
  const title = isPt
    ? `K-pop Quiz • Linha do Tempo ${referenceDate}`
    : `K-pop Quiz • Timeline ${referenceDate}`;
  const scoreLine = gaveUp
    ? (isPt
      ? `Desistência · Pontuação da sequência: ${score}/${totalEvents}`
      : `Gave up · Sequence score: ${score}/${totalEvents}`)
    : isPt
    ? `Pontuação: ${score}/${totalEvents} ⭐️`
    : `Score: ${score}/${totalEvents} ⭐️`;
  const emojiLine = results.map((r) => (r ? "🟩" : "🟥")).join(" ");
  return withShareUrl(`${title}\n${scoreLine}\n${emojiLine}`, seoShareUrl("timeline", locale));
}
