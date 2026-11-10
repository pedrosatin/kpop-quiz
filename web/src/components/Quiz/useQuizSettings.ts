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
  const decadeKey = decades.join(",");

  const selectTheme = (next: QuizTheme) => {
    setTheme(next);
    setDecades([]);
    updateUrlParams(playMode, next, []);
  };

  const selectDecades = (selected: QuizDecadeSelection) => {
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
  };
}

export type QuizSettings = ReturnType<typeof useQuizSettings>;
