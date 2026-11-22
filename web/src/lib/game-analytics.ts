import { useEffect, useRef, useState } from "preact/hooks";
import { dailyReferenceDate } from "../data/daily-artifact";
import { getLocalStorageItem } from "./local-storage";
import { getDaysDifference, loadPlayerStats } from "./player-stats";
import type { Locale, PlayMode } from "./quiz-types";

export type AnalyticsGame =
  | "quiz"
  | "grid"
  | "connections"
  | "name-guess"
  | "word-search"
  | "timeline"
  | "map"
  | "code"
  | "crossword"
  | "strands"
  | "daily_set";
export interface GameAnalyticsContext {
  game: AnalyticsGame;
  locale: Locale;
  mode?: PlayMode;
  /** For `share`: whether the shared result is the day's challenge. */
  daily?: "yes" | "no";
  /** Overrides the default `game_result` content type on share events. */
  contentType?: string;
  /** Overrides the default `item_id` (the game id) on share events. */
  itemId?: string;
}
export type ShareMethod = "native" | "clipboard";
export type GameOutcome = "win" | "loss" | "give_up";

/** The shared context plus what only a round knows. */
export interface GameRoundContext extends GameAnalyticsContext {
  /** True for the day's challenge, false for free play or a replay. Read once, when the round begins. */
  isDaily: () => boolean;
  /** How the round ended; null while it is being played. */
  outcome: GameOutcome | null;
  /**
   * When true, skip reading home-quiz player stats for return bands
   * (`days_since_last`, `streak_bucket`). Used by group-page free play so
   * the pilot does not inherit streaks from the general games.
   */
  omitReturnBands?: boolean;
}

type EventDetails = Record<string, string | undefined>;
type GameAnalyticsEvent = "game_start" | "game_complete" | "share" | "daily_set_complete";

let measurementId = "";
let accepted = false;
export function setGameAnalyticsConsent(id: string, consent: boolean): void {
  measurementId = id;
  accepted = consent && id.length > 0;
}

function sendRawEvent(event: GameAnalyticsEvent, params: Record<string, string>): void {
  if (typeof window === "undefined" || !accepted || !measurementId) return;
  try {
    if (getLocalStorageItem("kpop-quiz-consent") === "rejected") return;
    const w = window as unknown as Record<string, unknown>;
    if (w[`ga-disable-${measurementId}`] === true || typeof w.gtag !== "function") return;
    (w.gtag as (...args: unknown[]) => void)("event", event, { ...params, send_to: measurementId });
  } catch {
  }
}

function sendGameEvent(
  event: "game_start" | "game_complete" | "share",
  context: GameAnalyticsContext,
  details: EventDetails = {},
): void {
  sendRawEvent(event, {
    game: context.game,
    locale: context.locale,
    ...(context.mode ? { mode: context.mode } : {}),
    ...Object.fromEntries(
      Object.entries(details).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  });
}

export function trackGameEvent(
  event: "game_start" | "game_complete" | "share",
  context: GameAnalyticsContext,
  method?: ShareMethod,
): void {
  sendGameEvent(
    event,
    context,
    event === "share"
      ? {
          method,
          content_type: context.contentType ?? "game_result",
          item_id: context.itemId ?? context.game,
          ...(context.daily ? { daily: context.daily } : {}),
        }
      : {},
  );
}

/** Fires once when the player finishes every daily game of the day. */
export function trackDailySetComplete(locale: Locale): void {
  sendRawEvent("daily_set_complete", { locale });
}

/**
 * Days since the game's last recorded day, in bands. "0" is another round on
 * the same day. A date ahead of today (clock moved back) has no band.
 */
export function daysSinceLastBucket(lastPlayedDate: string | undefined, today: string): string | undefined {
  if (!lastPlayedDate) return "first";
  const days = getDaysDifference(lastPlayedDate, today);
  if (days < 0) return undefined;
  if (days <= 1) return String(days);
  return days <= 7 ? "2-7" : "8+";
}

/** The game's stored streak, in bands. "0" means no active streak. */
export function streakBucket(streak: number): string {
  if (streak <= 1) return String(Math.max(streak, 0));
  if (streak <= 3) return "2-3";
  return streak <= 7 ? "4-7" : "8+";
}

function gameStats(context: GameRoundContext) {
  if (context.omitReturnBands || context.game === "map" || context.game === "daily_set") return null;
  return loadPlayerStats().games[context.game];
}

interface RoundSnapshot {
  daily: "yes" | "no";
  daysSinceLast: string | undefined;
}

function readRoundSnapshot(context: GameRoundContext): RoundSnapshot {
  try {
    const stats = gameStats(context);
    return {
      daily: context.isDaily() ? "yes" : "no",
      daysSinceLast: stats ? daysSinceLastBucket(stats.lastPlayedDate, dailyReferenceDate()) : undefined,
    };
  } catch {
    return { daily: "no", daysSinceLast: undefined };
  }
}

/** Lifecycle deduplication is independent of consent: activity is never replayed. */
export function useGameAnalytics(context: GameRoundContext, finished: boolean, resumed = false) {
  const started = useRef(resumed);
  const playedHere = useRef(false);
  const completed = useRef(false);
  const restartedHere = useRef(false);
  if (resumed && !playedHere.current && !restartedHere.current) started.current = true;
  const contextRef = useRef(context);
  contextRef.current = context;
  const round = useRef<RoundSnapshot | null>(null);
  const [completions, setCompletions] = useState(0);

  useEffect(() => {
    if (!finished || !playedHere.current || completed.current) return;
    completed.current = true;
    setCompletions((n) => n + 1);
  }, [finished]);

  useEffect(() => {
    if (completions === 0 || !round.current) return;
    const current = contextRef.current;
    const stats = gameStats(current);
    sendGameEvent("game_complete", current, {
      daily: round.current.daily,
      outcome: current.outcome ?? undefined,
      days_since_last: round.current.daysSinceLast,
      streak_bucket: stats ? streakBucket(stats.currentStreak) : undefined,
    });
  }, [completions]);

  const start = () => {
    playedHere.current = true;
    round.current ??= readRoundSnapshot(contextRef.current);
    if (started.current) return;
    started.current = true;
    sendGameEvent("game_start", contextRef.current, { daily: round.current.daily });
  };
  const reset = () => {
    restartedHere.current = true;
    started.current = false;
    playedHere.current = false;
    completed.current = false;
    round.current = null;
  };
  const resume = () => {
    started.current = true;
    playedHere.current = false;
    completed.current = false;
    round.current = null;
  };
  return { start, reset, resume };
}
