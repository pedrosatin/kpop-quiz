import { useState } from "preact/hooks";
import type { Locale, PlayMode } from "../../lib/quiz-types";
import { loadStoredPreferences, saveStoredPlayMode, saveStoredTimerEnabled } from "./storage";
import {
  getInitialUrlParams,
  updateUrlParams,
  type QuizDecadeSelection,
  type QuizDecadeValue,
  type QuizTheme,
} from "./url-params";

/** What the player picked on the setup screen, mirrored to the URL and preferences. */
export function useQuizSettings(locale: Locale, initialAvailableDecades: QuizDecadeValue[]) {
  const [playMode, setPlayMode] = useState<PlayMode>(() => getInitialUrlParams().playMode);
  const [theme, setTheme] = useState<QuizTheme>(() => getInitialUrlParams().theme);
  const [decades, setDecades] = useState<QuizDecadeSelection>(() => getInitialUrlParams().decades);
  const [availableDecades, setAvailableDecades] = useState<QuizDecadeValue[]>(initialAvailableDecades);
  const [timerEnabled, setTimerEnabled] = useState<boolean>(() => loadStoredPreferences().timerEnabled ?? false);
  // The visit fell on the default theme and the player has not picked one yet.
  const [onDefaultTheme, setOnDefaultTheme] = useState<boolean>(() => !getInitialUrlParams().themeNamed);
  const decadeKey = decades.join(",");

  const selectTheme = (next: QuizTheme) => {
    setOnDefaultTheme(false);
    setTheme(next);
    setDecades([]);
    updateUrlParams(playMode, next, []);
  };

  const selectDecades = (selected: QuizDecadeSelection) => {
    setOnDefaultTheme(false);
    setDecades(selected);
    setTheme("history");
    updateUrlParams(playMode, "history", selected);
  };

  const selectMode = (mode: PlayMode) => {
    setPlayMode(mode);
    saveStoredPlayMode(mode);
    updateUrlParams(mode, theme, decades);
  };

  const changeTimer = (enabled: boolean) => {
    setTimerEnabled(enabled);
    saveStoredTimerEnabled(enabled);
  };

  /** Clears an active decade filter; false when there was none to clear. */
  const clearDecadeFilter = (): boolean => {
    if (!decades.length) return false;
    setDecades([]);
    setTheme("history");
    updateUrlParams(playMode, "history", []);
    return true;
  };

  return {
    playMode,
    theme,
    onDefaultTheme,
    decades,
    setDecades,
    decadeKey,
    requestKey: `${locale}|${playMode}|${theme}|${decadeKey}`,
    availableDecades,
    setAvailableDecades,
    timerEnabled,
    setTimerEnabled,
    selectTheme,
    selectDecades,
    selectMode,
    changeTimer,
    clearDecadeFilter,
    /** Home quiz mirrors mode/theme into the URL; group pages keep the path clean. */
    syncUrl: true,
    /** Home quiz writes a localStorage slot; group pages skip persistence. */
    persist: true,
  };
}

/**
 * Fixed free-play settings for a group landing quiz: theme `history` so
 * `quizDailyDate` stays undefined (session-<id> stats, restart button, no
 * daily share), no URL sync, and no progress slot (avoids wiping the home
 * daily or general-history saves).
 */
export function useGroupQuizSettings(locale: Locale): QuizSettings {
  const [availableDecades, setAvailableDecades] = useState<QuizDecadeValue[]>([]);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [decades, setDecades] = useState<QuizDecadeSelection>([]);
  const playMode: PlayMode = "standard";
  const theme: QuizTheme = "history";

  return {
    playMode,
    theme,
    onDefaultTheme: false,
    decades,
    setDecades,
    decadeKey: decades.join(","),
    requestKey: `${locale}|${playMode}|${theme}|${decades.join(",")}`,
    availableDecades,
    setAvailableDecades,
    timerEnabled,
    setTimerEnabled,
    selectTheme: () => undefined,
    selectDecades: () => undefined,
    selectMode: () => undefined,
    changeTimer: setTimerEnabled,
    clearDecadeFilter: () => false,
    syncUrl: false,
    persist: false,
  };
}

export type QuizSettings = ReturnType<typeof useQuizSettings>;
