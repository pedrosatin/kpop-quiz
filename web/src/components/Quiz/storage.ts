import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../../lib/quiz-types";
import type { QuizDecadeSelection, QuizTheme } from "./url-params";
import type { QuestionResult, QuizMachineState } from "./types";

const STORAGE_PLAY_MODE = "kpop-quiz-play-mode";
const STORAGE_TIMER_ENABLED = "kpop-quiz-timer-enabled";

/** localStorage key for the single in-progress Quiz resume slot. */
export const QUIZ_PROGRESS_STORAGE_KEY = "kpop-quiz-progress";

export const QUIZ_PROGRESS_SCHEMA = "kpop-quiz-progress-v1" as const;

/**
 * Additive envelope for Q04 local progress saves. Older payloads without
 * `catalog_version` remain readable; catalog rounds include the field.
 */
export type QuizProgressEnvelope = {
  schema_version: typeof QUIZ_PROGRESS_SCHEMA;
  session_id: string;
  dataset_version: string;
  session_source: "catalog" | "published";
  catalog_version?: string;
};

export type QuizProgressMachineState = Extract<
  QuizMachineState,
  "question.ready" | "question.answered" | "results"
>;

export type QuizProgressHistoryEntry = {
  question_id: string;
  selected_option_id: string | null;
  is_correct: boolean;
  clues_used_count: number;
};

/**
 * Versioned local save for one Quiz round. Confirm-dialog open state is never
 * persisted: a reload must not authorize give-up from a stale confirmation.
 */
export type QuizProgressSave = QuizProgressEnvelope & {
  locale: Locale;
  play_mode: PlayMode;
  theme: QuizTheme;
  decades: QuizDecadeSelection;
  timer_enabled: boolean;
  session: QuizSession;
  machine_state: QuizProgressMachineState;
  question_index: number;
  selected_id: string | null;
  timed_out: boolean;
  score: number;
  revealed_clues: string[];
  history: QuizProgressHistoryEntry[];
  /** Absolute deadline for the active question; null when timer off or not ready. */
  question_deadline_ms: number | null;
  started_at_ms: number;
  elapsed_seconds: number;
  gave_up: boolean;
  replay_notice: "ok" | "repeats" | "legacy-repeats" | null;
};

export type QuizProgressLoadResult =
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "invalid" }
  | { status: "ok"; save: QuizProgressSave };

export type QuizProgressWriteResult = "ok" | "unavailable";

export type QuizProgressCompatContext = {
  locale: Locale;
  playMode: PlayMode;
  theme: QuizTheme;
  decades: QuizDecadeSelection;
  session: QuizSession;
  sessionSource: "catalog" | "published";
  /** Current catalog version when sessionSource is catalog; otherwise omitted. */
  catalogVersion?: string;
};

export type QuizProgressCompatResult = "ok" | "incompatible" | "invalid";

/** Build the identity slice Q04 will persist alongside round progress. */
export function buildQuizProgressEnvelope(
  session: QuizSession,
  sessionSource: "catalog" | "published",
): QuizProgressEnvelope {
  const envelope: QuizProgressEnvelope = {
    schema_version: QUIZ_PROGRESS_SCHEMA,
    session_id: session.session_id,
    dataset_version: session.dataset_version,
    session_source: sessionSource,
  };
  if (typeof session.catalog_version === "string" && session.catalog_version.length > 0) {
    envelope.catalog_version = session.catalog_version;
  }
  return envelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocale(value: unknown): value is Locale {
  return value === "pt-BR" || value === "en";
}

function isPlayMode(value: unknown): value is PlayMode {
  return value === "assisted" || value === "standard" || value === "expert";
}

function isTheme(value: unknown): value is QuizTheme {
  return value === "history" || value === "daily";
}

function isDecadeSelection(value: unknown): value is QuizDecadeSelection {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) => item === 1990 || item === 2000 || item === 2010 || item === 2020,
  );
}

function isHistoryEntry(value: unknown): value is QuizProgressHistoryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.question_id === "string"
    && value.question_id.length > 0
    && (value.selected_option_id === null || typeof value.selected_option_id === "string")
    && typeof value.is_correct === "boolean"
    && typeof value.clues_used_count === "number"
    && Number.isInteger(value.clues_used_count)
    && value.clues_used_count >= 0
  );
}

function decadesKey(decades: readonly number[]): string {
  return [...decades].sort((a, b) => a - b).join(",");
}

/** Parse and structurally validate a progress payload (no artifact check yet). */
export function parseQuizProgressSave(raw: unknown): QuizProgressSave | null {
  if (!isRecord(raw)) return null;
  if (raw.schema_version !== QUIZ_PROGRESS_SCHEMA) return null;
  if (typeof raw.session_id !== "string" || raw.session_id.length === 0) return null;
  if (typeof raw.dataset_version !== "string" || raw.dataset_version.length === 0) return null;
  if (raw.session_source !== "catalog" && raw.session_source !== "published") return null;
  if (
    raw.catalog_version !== undefined
    && (typeof raw.catalog_version !== "string" || raw.catalog_version.length === 0)
  ) {
    return null;
  }
  if (!isLocale(raw.locale) || !isPlayMode(raw.play_mode) || !isTheme(raw.theme)) return null;
  if (!isDecadeSelection(raw.decades) || typeof raw.timer_enabled !== "boolean") return null;
  if (!isQuizSession(raw.session)) return null;
  if (
    raw.machine_state !== "question.ready"
    && raw.machine_state !== "question.answered"
    && raw.machine_state !== "results"
  ) {
    return null;
  }
  if (
    typeof raw.question_index !== "number"
    || !Number.isInteger(raw.question_index)
    || raw.question_index < 0
  ) {
    return null;
  }
  if (raw.selected_id !== null && typeof raw.selected_id !== "string") return null;
  if (typeof raw.timed_out !== "boolean" || typeof raw.score !== "number" || !Number.isFinite(raw.score)) {
    return null;
  }
  if (
    !Array.isArray(raw.revealed_clues)
    || !raw.revealed_clues.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return null;
  }
  if (!Array.isArray(raw.history) || !raw.history.every(isHistoryEntry)) return null;
  if (
    raw.question_deadline_ms !== null
    && (typeof raw.question_deadline_ms !== "number" || !Number.isFinite(raw.question_deadline_ms))
  ) {
    return null;
  }
  if (typeof raw.started_at_ms !== "number" || !Number.isFinite(raw.started_at_ms)) return null;
  if (
    typeof raw.elapsed_seconds !== "number"
    || !Number.isFinite(raw.elapsed_seconds)
    || raw.elapsed_seconds < 0
  ) {
    return null;
  }
  if (typeof raw.gave_up !== "boolean") return null;
  if (
    raw.replay_notice !== null
    && raw.replay_notice !== "ok"
    && raw.replay_notice !== "repeats"
    && raw.replay_notice !== "legacy-repeats"
  ) {
    return null;
  }

  const save = raw as unknown as QuizProgressSave;
  if (save.session.session_id !== save.session_id) return null;
  if (save.session.dataset_version !== save.dataset_version) return null;
  if (save.session_source === "catalog") {
    if (typeof save.catalog_version !== "string" || save.catalog_version.length === 0) return null;
    if (save.session.catalog_version !== save.catalog_version) return null;
  } else if (save.catalog_version !== undefined) {
    return null;
  }
  if (!progressMatchesSession(save)) return null;
  return save;
}

/** Progress counters and ids must be reachable from the embedded session. */
export function progressMatchesSession(save: QuizProgressSave): boolean {
  const { session, machine_state, question_index, history, revealed_clues, selected_id } = save;
  const total = session.questions.length;
  if (total === 0) return false;
  if (question_index < 0 || question_index >= total) return false;
  if (machine_state === "results") {
    // Give-up may finish from any index; history must cover the whole round.
    if (history.length !== total) return false;
  } else if (machine_state === "question.ready") {
    if (history.length !== question_index) return false;
  } else if (history.length !== question_index + 1) {
    return false;
  }

  for (let i = 0; i < history.length; i++) {
    const entry = history[i]!;
    const question = session.questions[i];
    if (!question || question.id !== entry.question_id) return false;
    if (
      entry.selected_option_id !== null
      && !question.options.some((option) => option.id === entry.selected_option_id)
    ) {
      return false;
    }
  }

  if (machine_state !== "results") {
    const current = session.questions[question_index];
    if (!current) return false;
    if (selected_id !== null && !current.options.some((option) => option.id === selected_id)) {
      return false;
    }
    const allowed = new Set(current.clues_available.map((clue) => clue.id));
    if (revealed_clues.some((id) => !allowed.has(id))) return false;
  }
  return true;
}

/**
 * Compare a structurally valid save to the live artifact / request. Rejects
 * identity or catalog-version drift so stats stay tied to one selection.
 */
export function checkQuizProgressCompatibility(
  save: QuizProgressSave,
  context: QuizProgressCompatContext,
): QuizProgressCompatResult {
  if (!progressMatchesSession(save)) return "invalid";
  if (save.locale !== context.locale) return "incompatible";
  if (save.play_mode !== context.playMode) return "incompatible";
  if (save.theme !== context.theme) return "incompatible";
  if (decadesKey(save.decades) !== decadesKey(context.decades)) return "incompatible";
  if (save.session_source !== context.sessionSource) return "incompatible";
  if (save.session_id !== context.session.session_id) return "incompatible";
  if (save.dataset_version !== context.session.dataset_version) return "incompatible";
  if (save.session_source === "catalog") {
    if (!context.catalogVersion || save.catalog_version !== context.catalogVersion) {
      return "incompatible";
    }
    if (context.session.catalog_version && save.catalog_version !== context.session.catalog_version) {
      return "incompatible";
    }
  }
  // Question sequence must match the live session (published bytes or restored catalog set).
  if (save.session.questions.length !== context.session.questions.length) return "incompatible";
  for (let i = 0; i < save.session.questions.length; i++) {
    if (save.session.questions[i]!.id !== context.session.questions[i]!.id) return "incompatible";
    if (save.session.questions[i]!.semantic_id !== context.session.questions[i]!.semantic_id) {
      return "incompatible";
    }
  }
  return "ok";
}

export function compactHistory(history: readonly QuestionResult[]): QuizProgressHistoryEntry[] {
  return history.map((entry) => ({
    question_id: entry.question.id,
    selected_option_id: entry.selectedOptionId,
    is_correct: entry.isCorrect,
    clues_used_count: entry.cluesUsedCount,
  }));
}

export function expandHistory(
  entries: readonly QuizProgressHistoryEntry[],
  session: QuizSession,
): QuestionResult[] | null {
  const expanded: QuestionResult[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const question = session.questions[i];
    if (!question || question.id !== entry.question_id) return null;
    expanded.push({
      question,
      selectedOptionId: entry.selected_option_id,
      isCorrect: entry.is_correct,
      cluesUsedCount: entry.clues_used_count,
    });
  }
  return expanded;
}

export function buildQuizProgressSave(input: {
  session: QuizSession;
  sessionSource: "catalog" | "published";
  locale: Locale;
  playMode: PlayMode;
  theme: QuizTheme;
  decades: QuizDecadeSelection;
  timerEnabled: boolean;
  machineState: QuizProgressMachineState;
  questionIndex: number;
  selectedId: string | null;
  timedOut: boolean;
  score: number;
  revealedClues: readonly string[];
  history: readonly QuestionResult[];
  questionDeadlineMs: number | null;
  startedAtMs: number;
  elapsedSeconds: number;
  gaveUp: boolean;
  replayNotice: "ok" | "repeats" | "legacy-repeats" | null;
}): QuizProgressSave {
  const envelope = buildQuizProgressEnvelope(input.session, input.sessionSource);
  return {
    ...envelope,
    locale: input.locale,
    play_mode: input.playMode,
    theme: input.theme,
    decades: [...input.decades] as QuizDecadeSelection,
    timer_enabled: input.timerEnabled,
    session: input.session,
    machine_state: input.machineState,
    question_index: input.questionIndex,
    selected_id: input.selectedId,
    timed_out: input.timedOut,
    score: input.score,
    revealed_clues: [...input.revealedClues],
    history: compactHistory(input.history),
    question_deadline_ms: input.questionDeadlineMs,
    started_at_ms: input.startedAtMs,
    elapsed_seconds: input.elapsedSeconds,
    gave_up: input.gaveUp,
    replay_notice: input.replayNotice,
  };
}

export function loadQuizProgressSave(): QuizProgressLoadResult {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(QUIZ_PROGRESS_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  const save = parseQuizProgressSave(parsed);
  if (!save) return { status: "invalid" };
  return { status: "ok", save };
}

export function saveQuizProgress(save: QuizProgressSave): QuizProgressWriteResult {
  try {
    window.localStorage.setItem(QUIZ_PROGRESS_STORAGE_KEY, JSON.stringify(save));
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function clearQuizProgress(): QuizProgressWriteResult {
  try {
    window.localStorage.removeItem(QUIZ_PROGRESS_STORAGE_KEY);
    return "ok";
  } catch {
    return "unavailable";
  }
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
