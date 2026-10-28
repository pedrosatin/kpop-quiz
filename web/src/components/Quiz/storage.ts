import type { PlayMode, QuizSession } from "../../lib/quiz-types";

const STORAGE_PLAY_MODE = "kpop-quiz-play-mode";
const STORAGE_TIMER_ENABLED = "kpop-quiz-timer-enabled";

/**
 * Additive envelope for Q04 local progress saves. Older payloads without
 * `catalog_version` remain readable; catalog rounds include the field.
 */
export type QuizProgressEnvelope = {
  schema_version: "kpop-quiz-progress-v1";
  session_id: string;
  dataset_version: string;
  session_source: "catalog" | "published";
  catalog_version?: string;
};

/** Build the identity slice Q04 will persist alongside round progress. */
export function buildQuizProgressEnvelope(
  session: QuizSession,
  sessionSource: "catalog" | "published",
): QuizProgressEnvelope {
  const envelope: QuizProgressEnvelope = {
    schema_version: "kpop-quiz-progress-v1",
    session_id: session.session_id,
    dataset_version: session.dataset_version,
    session_source: sessionSource,
  };
  if (typeof session.catalog_version === "string" && session.catalog_version.length > 0) {
    envelope.catalog_version = session.catalog_version;
  }
  return envelope;
}

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
