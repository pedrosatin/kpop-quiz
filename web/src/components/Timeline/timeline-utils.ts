import type { TimelineEvent, TimelinePuzzle } from "../../lib/timeline-types";
import type { Locale } from "../../lib/quiz-types";
import type { TimelineStoredState } from "./types";

/**
 * Sort events chronologically by date string. Break ties by event ID.
 */
export function getCanonicalChronologicalOrder(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
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
    if (typeof parsed.score !== "number" || !Number.isInteger(parsed.score) || parsed.score < 0) return null;
    if (!Array.isArray(parsed.results) || !parsed.results.every((r: unknown) => typeof r === "boolean")) {
      return null;
    }
    if (!Array.isArray(parsed.orderedEventIds)) return null;

    if (parsed.orderedEventIds.length !== puzzle.events.length) return null;
    const puzzleEventIds = new Set(puzzle.events.map((e) => e.id));
    if (parsed.orderedEventIds.some((id: unknown) => typeof id !== "string" || !puzzleEventIds.has(id))) {
      return null;
    }
    if (new Set(parsed.orderedEventIds).size !== puzzle.events.length) return null;

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
  referenceDate: string;
  score: number;
  totalEvents: number;
  results: boolean[];
  locale: Locale;
  origin?: string | undefined;
}

/**
 * Format spoiler-free timeline share text with score, emojis, and URL.
 */
export function generateTimelineShareText({
  referenceDate,
  score,
  totalEvents,
  results,
  locale,
  origin,
}: GenerateTimelineShareTextParams): string {
  const isPt = locale === "pt-BR";
  const title = isPt
    ? `K-pop Quiz • Linha do Tempo ${referenceDate}`
    : `K-pop Quiz • Timeline ${referenceDate}`;
  const scoreLine = isPt
    ? `Pontuação: ${score}/${totalEvents} ⭐️`
    : `Score: ${score}/${totalEvents} ⭐️`;
  const emojiLine = results.map((r) => (r ? "🟩" : "🟥")).join(" ");
  const base = (origin || "https://kpopquiz.online").replace(/\/+$/, "");
  const path = isPt ? "/pt-br/linha-do-tempo/" : "/en/timeline/";
  const url = `${base}${path}`;

  return `${title}\n${scoreLine}\n${emojiLine}\n${url}`;
}
