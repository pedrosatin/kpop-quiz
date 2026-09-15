export type Locale = "pt-BR" | "en";
export type PlayMode = "assisted" | "standard" | "expert";
export type ChallengeRating = "easy" | "medium" | "hard";
export type ValueType = "group" | "person" | "organization" | "release" | "time" | "number";

export interface QuizOption {
  id: string;
  label: string;
  value: string;
  value_type: ValueType;
}

export interface Evidence {
  fact_base_id: string;
  locator: string;
  revision_id: number;
  source_key: string;
  source_url: string;
}

export interface QuizClue {
  id: string;
  type: "decade";
  text: string;
  fact_base_ids: string[];
  evidence: Evidence[];
}

export interface QuizQuestion {
  id: string;
  logical_id: string;
  base_logical_id: string;
  semantic_id: string;
  fact_base_ids: string[];
  language: Locale;
  type: string;
  theme: string;
  play_mode: PlayMode;
  challenge_rating: ChallengeRating;
  base_points: number;
  hint_cost: number;
  clues_available: QuizClue[];
  clues_shown: string[];
  group_ids: string[];
  prompt: string;
  options: QuizOption[];
  answer_option_id: string;
  explanation: string;
  reference_date: string;
  evidence: Evidence[];
}

export interface QuizSession {
  schema_version: "kpop-quiz-session-v2";
  dataset_version: string;
  session_id: string;
  config: {
    language: Locale;
    seed: string;
    theme: string | null;
    group_id: string | null;
    play_mode: PlayMode;
    timer_seconds: number | null;
  };
  questions: QuizQuestion[];
}

const HASH = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAY_MODES = new Set<PlayMode>(["assisted", "standard", "expert"]);
const RATINGS = new Set<ChallengeRating>(["easy", "medium", "hard"]);
const VALUE_TYPES = new Set<ValueType>(["group", "person", "organization", "release", "time", "number"]);
const QUESTION_TYPES = new Set([
  "formation_year", "member_at_date", "birth_date_or_place", "age_on_date",
  "group_for_member", "member_for_group", "group_for_record_label",
  "record_label_for_group", "chronological_comparison", "release_for_group",
  "group_for_release", "release_year", "earliest_release",
]);
const SESSION_FIELDS = ["schema_version", "dataset_version", "session_id", "config", "questions"];
const CONFIG_FIELDS = ["language", "seed", "theme", "group_id", "play_mode", "timer_seconds"];
const QUESTION_FIELDS = ["id", "logical_id", "base_logical_id", "semantic_id", "fact_base_ids", "language", "type", "theme", "play_mode", "challenge_rating", "base_points", "hint_cost", "clues_available", "clues_shown", "group_ids", "prompt", "options", "answer_option_id", "explanation", "reference_date", "evidence"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, fields: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function isStringArray(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isOption(value: unknown): value is QuizOption {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "label", "value", "value_type"])) return false;
  return typeof value.id === "string" && HASH.test(value.id)
    && typeof value.label === "string" && value.label.length > 0
    && typeof value.value === "string" && value.value.length > 0
    && typeof value.value_type === "string" && VALUE_TYPES.has(value.value_type as ValueType);
}

function isEvidence(value: unknown, factBaseIds: string[]): value is Evidence {
  if (!isRecord(value) || !hasExactKeys(value, ["fact_base_id", "locator", "revision_id", "source_key", "source_url"])) return false;
  return typeof value.fact_base_id === "string" && factBaseIds.includes(value.fact_base_id)
    && typeof value.locator === "string" && value.locator.length > 0
    && Number.isInteger(value.revision_id) && (value.revision_id as number) > 0
    && typeof value.source_key === "string" && value.source_key.length > 0
    && isHttpsUrl(value.source_url);
}

function isClue(value: unknown, questionFactIds: string[]): value is QuizClue {
  if (!isRecord(value) || !hasExactKeys(value, ["evidence", "fact_base_ids", "id", "text", "type"])) return false;
  if (typeof value.id !== "string" || !HASH.test(value.id) || value.type !== "decade"
    || typeof value.text !== "string" || value.text.length === 0
    || !isStringArray(value.fact_base_ids, false)
    || !(value.fact_base_ids as string[]).every((id) => questionFactIds.includes(id))
    || !Array.isArray(value.evidence)
    || !(value.evidence as unknown[]).every((item) => isEvidence(item, value.fact_base_ids as string[]))) return false;
  return new Set((value.evidence as Evidence[]).map((item) => item.fact_base_id)).size === (value.fact_base_ids as string[]).length;
}

function isQuestion(value: unknown, locale: Locale): value is QuizQuestion {
  if (!isRecord(value) || !hasExactKeys(value, QUESTION_FIELDS)) return false;
  if (typeof value.id !== "string" || !HASH.test(value.id)
    || typeof value.logical_id !== "string" || !HASH.test(value.logical_id)
    || typeof value.base_logical_id !== "string" || !HASH.test(value.base_logical_id)
    || typeof value.semantic_id !== "string" || !HASH.test(value.semantic_id)
    || value.language !== locale
    || typeof value.type !== "string" || !QUESTION_TYPES.has(value.type)
    || typeof value.theme !== "string" || value.theme.length === 0
    || typeof value.play_mode !== "string" || !PLAY_MODES.has(value.play_mode as PlayMode)
    || typeof value.challenge_rating !== "string" || !RATINGS.has(value.challenge_rating as ChallengeRating)
    || !Number.isInteger(value.base_points) || (value.base_points as number) < 1
    || !Number.isInteger(value.hint_cost) || (value.hint_cost as number) < 0
    || typeof value.prompt !== "string" || value.prompt.length === 0
    || typeof value.explanation !== "string" || value.explanation.length === 0
    || !isDate(value.reference_date)
    || !isStringArray(value.fact_base_ids, false)
    || !isStringArray(value.group_ids)
    || !Array.isArray(value.clues_available)
    || !(value.clues_available as unknown[]).every((clue) => isClue(clue, value.fact_base_ids as string[]))
    || !isStringArray(value.clues_shown)) return false;
  const clueIds = (value.clues_available as QuizClue[]).map((clue) => clue.id);
  if (new Set(clueIds).size !== clueIds.length
    || !(value.clues_shown as string[]).every((id) => clueIds.includes(id))
    || (value.play_mode !== "assisted" && (value.clues_shown as string[]).length > 0)
    || (value.play_mode === "expert" && clueIds.length > 0)) return false;
  if (!Array.isArray(value.options) || value.options.length !== 4 || !value.options.every(isOption)) return false;
  const optionIds = value.options.map((option) => option.id);
  const optionLabels = value.options.map((option) => option.label);
  const optionValues = value.options.map((option) => option.value);
  const optionTypes = value.options.map((option) => option.value_type);
  return new Set(optionIds).size === optionIds.length
    && new Set(optionLabels).size === optionLabels.length
    && new Set(optionValues).size === optionValues.length
    && new Set(optionTypes).size === 1
    && typeof value.answer_option_id === "string"
    && optionIds.includes(value.answer_option_id)
    && Array.isArray(value.evidence)
    && value.evidence.length > 0
    && value.evidence.every((item) => isEvidence(item, value.fact_base_ids as string[]))
    && new Set((value.evidence as Evidence[]).map((item) => item.fact_base_id)).size === (value.fact_base_ids as string[]).length;
}

export function isQuizSession(value: unknown): value is QuizSession {
  if (!isRecord(value) || !hasExactKeys(value, SESSION_FIELDS) || !isRecord(value.config) || !hasExactKeys(value.config, CONFIG_FIELDS)) return false;
  const { config } = value;
  if (value.schema_version !== "kpop-quiz-session-v2"
    || typeof value.dataset_version !== "string" || !HASH.test(value.dataset_version)
    || typeof value.session_id !== "string" || !HASH.test(value.session_id)
    || (config.language !== "pt-BR" && config.language !== "en")
    || typeof config.seed !== "string"
    || !(config.theme === null || typeof config.theme === "string" && config.theme.length > 0)
    || !(config.group_id === null || typeof config.group_id === "string" && config.group_id.length > 0)
    || !(typeof config.play_mode === "string" && PLAY_MODES.has(config.play_mode as PlayMode))
    || !(config.timer_seconds === null || Number.isInteger(config.timer_seconds) && (config.timer_seconds as number) > 0)
    || !Array.isArray(value.questions) || value.questions.length !== 10) return false;
  const locale = config.language;
  if (!value.questions.every((question) => isQuestion(question, locale))) return false;
  const questions = value.questions as QuizQuestion[];
  return new Set(questions.map((question) => question.id)).size === questions.length
    && new Set(questions.map((question) => question.semantic_id)).size === questions.length
    && questions.every((question) => (config.theme === null || question.theme === config.theme)
      && (config.group_id === null || question.group_ids.includes(config.group_id as string))
      && question.play_mode === config.play_mode);
}
