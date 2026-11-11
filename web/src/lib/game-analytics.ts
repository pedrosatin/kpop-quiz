import { useEffect, useRef, useState } from "preact/hooks";
import { dailyReferenceDate } from "../data/daily-artifact";
import { getDaysDifference, loadPlayerStats } from "./player-stats";
import type { Locale, PlayMode } from "./quiz-types";

export type AnalyticsGame = "quiz" | "grid" | "connections" | "name-guess" | "word-search" | "timeline" | "map" | "code" | "crossword";
export interface GameAnalyticsContext {
  game: AnalyticsGame;
  locale: Locale;
  mode?: PlayMode;
}
export type ShareMethod = "native" | "clipboard";
export type GameOutcome = "win" | "loss" | "give_up";

/** The shared context plus what only a round knows. */
export interface GameRoundContext extends GameAnalyticsContext {
  /** True for the day's challenge, false for free play or a replay. Read once, when the round begins. */
  isDaily: () => boolean;
  /** How the round ended; null while it is being played. */
  outcome: GameOutcome | null;
}

type EventDetails = Record<string, string | undefined>;

// Only ConsentBanner enables measurement, and only when it is mounted on a
// production page with a measurement ID. Saved consent alone cannot enable it.
let measurementId = "";
let accepted = false;
export function setGameAnalyticsConsent(id: string, consent: boolean): void {
  measurementId = id;
  accepted = consent && id.length > 0;
}

function sendGameEvent(
  event: "game_start" | "game_complete" | "share",
  context: GameAnalyticsContext,
  details: EventDetails = {},
): void {
  if (typeof window === "undefined" || !accepted || !measurementId) return;
  try {
    // Honor a rejection made in another tab, too. Private-mode storage may
    // throw; the explicit in-memory choice still applies to this visit.
    try {
      if (window.localStorage.getItem("kpop-quiz-consent") === "rejected") return;
    } catch { /* storage is optional */ }
    const w = window as unknown as Record<string, unknown>;
    if (w[`ga-disable-${measurementId}`] === true || typeof w.gtag !== "function") return;
    const params = {
      game: context.game,
      locale: context.locale,
      ...(context.mode ? { mode: context.mode } : {}),
      ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)),
      send_to: measurementId,
    };
    (w.gtag as (...args: unknown[]) => void)("event", event, params);
  } catch {
    // Analytics must never interrupt a game.
  }
}

export function trackGameEvent(
  event: "game_start" | "game_complete" | "share",
  context: GameAnalyticsContext,
  method?: ShareMethod,
): void {
  sendGameEvent(event, context, event === "share" ? { method, content_type: "game_result", item_id: context.game } : {});
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

// The Map records stats, but its analytics never sent return bands and still sends none.
function gameStats(game: AnalyticsGame) {
  return game === "map" ? null : loadPlayerStats().games[game];
}

interface RoundSnapshot {
  daily: "yes" | "no";
  daysSinceLast: string | undefined;
}

function readRoundSnapshot(context: GameRoundContext): RoundSnapshot {
  try {
    const stats = gameStats(context.game);
    return {
      daily: context.isDaily() ? "yes" : "no",
      // The day turns in Sao Paulo, like the daily boards whose dates are stored.
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
  // A restored save marks the game as started, but only until the player
  // resets: the next round of the same visit starts (and is counted) afresh.
  const restartedHere = useRef(false);
  if (resumed && !playedHere.current && !restartedHere.current) started.current = true;
  const contextRef = useRef(context);
  contextRef.current = context;
  // Taken when the round begins, because saving its result overwrites the
  // last played date and marks the day's board as already played.
  const round = useRef<RoundSnapshot | null>(null);
  const [completions, setCompletions] = useState(0);

  useEffect(() => {
    if (!finished || !playedHere.current || completed.current) return;
    completed.current = true;
    // The game saves its stats in an effect of this same commit, before or
    // after this one depending on the game. The next commit follows both.
    setCompletions((n) => n + 1);
  }, [finished]);

  useEffect(() => {
    if (completions === 0 || !round.current) return;
    const current = contextRef.current;
    const stats = gameStats(current.game);
    sendGameEvent("game_complete", current, {
      daily: round.current.daily,
      outcome: current.outcome ?? undefined,
      days_since_last: round.current.daysSinceLast,
      // Whatever streak rule player-stats applies; a change there shifts this band.
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
  return { start, reset };
}
