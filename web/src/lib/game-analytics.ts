import { useEffect, useRef } from "preact/hooks";
import type { Locale, PlayMode } from "./quiz-types";

export type AnalyticsGame = "quiz" | "grid" | "connections" | "name-guess" | "word-search" | "timeline" | "map" | "code";
export interface GameAnalyticsContext {
  game: AnalyticsGame;
  locale: Locale;
  mode?: PlayMode;
}
export type ShareMethod = "native" | "clipboard";

// Only ConsentBanner enables measurement, and only when it is mounted on a
// production page with a measurement ID. Saved consent alone cannot enable it.
let measurementId = "";
let accepted = false;
export function setGameAnalyticsConsent(id: string, consent: boolean): void {
  measurementId = id;
  accepted = consent && id.length > 0;
}

export function trackGameEvent(
  event: "game_start" | "game_complete" | "share",
  context: GameAnalyticsContext,
  method?: ShareMethod,
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
      ...(event === "share" ? { method, content_type: "game_result", item_id: context.game } : {}),
      send_to: measurementId,
    };
    (w.gtag as (...args: unknown[]) => void)("event", event, params);
  } catch {
    // Analytics must never interrupt a game.
  }
}

/** Lifecycle deduplication is independent of consent: activity is never replayed. */
export function useGameAnalytics(context: GameAnalyticsContext, finished: boolean, resumed = false) {
  const started = useRef(resumed);
  const playedHere = useRef(false);
  const completed = useRef(false);
  if (resumed && !playedHere.current) started.current = true;
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (!finished || !playedHere.current || completed.current) return;
    completed.current = true;
    trackGameEvent("game_complete", contextRef.current);
  }, [finished]);

  const start = () => {
    playedHere.current = true;
    if (started.current) return;
    started.current = true;
    trackGameEvent("game_start", contextRef.current);
  };
  const reset = () => {
    started.current = false;
    playedHere.current = false;
    completed.current = false;
  };
  return { start, reset };
}
