import type { PlayMode } from "../../lib/quiz-types";

const STORAGE_PLAY_MODE = "kpop-quiz-play-mode";
const STORAGE_TIMER_ENABLED = "kpop-quiz-timer-enabled";

export function loadStoredPreferences(): {
  playMode: PlayMode | null;
  timerEnabled: boolean | null;
} {
  let playMode: PlayMode | null = null;
  let timerEnabled: boolean | null = null;
  try {
    const storedMode = window.localStorage.getItem(STORAGE_PLAY_MODE);
    if (storedMode === "assisted" || storedMode === "standard" || storedMode === "expert") {
      playMode = storedMode;
    }
    const storedTimer = window.localStorage.getItem(STORAGE_TIMER_ENABLED);
    if (storedTimer !== null) {
      timerEnabled = storedTimer === "true";
    }
  } catch {
    // Storage is optional; private browsing may deny access.
  }
  return { playMode, timerEnabled };
}

export function saveStoredPlayMode(mode: PlayMode): void {
  try {
    window.localStorage.setItem(STORAGE_PLAY_MODE, mode);
  } catch {
    // Storage is optional.
  }
}

export function saveStoredTimerEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_TIMER_ENABLED, String(enabled));
  } catch {
    // Storage is optional.
  }
}
