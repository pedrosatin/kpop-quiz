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

export interface LicensedMedia {
  asset_url: string;
  source_url: string;
  creator: string;
  license_name: string;
  license_url: string;
  subject_qid: string;
  verified_at: string;
  transformations: string[];
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
  decades?: number[];
  group_relevance_score?: number | null;
  prompt: string;
  options: QuizOption[];
  answer_option_id: string;
  explanation: string;
  reference_date: string;
  evidence: Evidence[];
  media?: LicensedMedia | null;
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
    decade?: number | null;
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
const QUESTION_OPTIONAL_FIELDS = ["media", "decades", "group_relevance_score"];

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

export const PERMITTED_LICENSES = new Set([
  "CC0",
  "CC0 1.0",
  "CC BY 2.0",
  "CC BY 2.5",
  "CC BY 3.0",
  "CC BY 4.0",
  "CC BY-SA 2.0",
  "CC BY-SA 2.5",
  "CC BY-SA 3.0",
  "CC BY-SA 4.0",
  "Public Domain",
  "OFL 1.1",
]);
const LICENSED_MEDIA_FIELDS = [
  "asset_url",
  "source_url",
  "creator",
  "license_name",
  "license_url",
  "subject_qid",
  "verified_at",
  "transformations",
];
const QID = /^Q[1-9][0-9]*$/;

function isHttpOrHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLicensedMedia(value: unknown): value is LicensedMedia {
  if (!isRecord(value) || !hasExactKeys(value, LICENSED_MEDIA_FIELDS)) return false;
  return isHttpOrHttpsUrl(value.asset_url)
    && isHttpsUrl(value.source_url)
    && typeof value.creator === "string" && value.creator.trim().length > 0
    && typeof value.license_name === "string" && PERMITTED_LICENSES.has(value.license_name)
    && isHttpOrHttpsUrl(value.license_url)
    && typeof value.subject_qid === "string" && QID.test(value.subject_qid)
    && isDate(value.verified_at)
    && isStringArray(value.transformations, false);
}

export function isQuestion(value: unknown, locale: Locale): value is QuizQuestion {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length < QUESTION_FIELDS.length
    || keys.length > QUESTION_FIELDS.length + QUESTION_OPTIONAL_FIELDS.length
    || !QUESTION_FIELDS.every((field) => Object.hasOwn(value, field))
    || !keys.every((field) => QUESTION_FIELDS.includes(field) || QUESTION_OPTIONAL_FIELDS.includes(field))) return false;
  if (Object.hasOwn(value, "media") && value.media !== null && !isLicensedMedia(value.media)) return false;
  if (Object.hasOwn(value, "group_relevance_score")
    && value.group_relevance_score !== null
    && (!Number.isInteger(value.group_relevance_score)
      || (value.group_relevance_score as number) < 0
      || (value.group_relevance_score as number) > 10_000)) return false;
  if (Object.hasOwn(value, "decades")) {
    if (!Array.isArray(value.decades)) return false;
    const decades = value.decades as unknown[];
    if (!decades.every((decade) => Number.isInteger(decade)
        && [1990, 2000, 2010, 2020].includes(decade as number))
      || new Set(decades).size !== decades.length
      || decades.some((decade, index) => index > 0 && (decades[index - 1] as number) > (decade as number))) return false;
  }
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
  if (!isRecord(value) || !hasExactKeys(value, SESSION_FIELDS) || !isRecord(value.config)
    || !hasExactKeys(value.config, [...CONFIG_FIELDS, ...(Object.hasOwn(value.config, "decade") ? ["decade"] : [])])) return false;
  const { config } = value;
  if (value.schema_version !== "kpop-quiz-session-v2"
    || typeof value.dataset_version !== "string" || !HASH.test(value.dataset_version)
    || typeof value.session_id !== "string" || !HASH.test(value.session_id)
    || (config.language !== "pt-BR" && config.language !== "en")
    || typeof config.seed !== "string"
    || !(config.theme === null || typeof config.theme === "string" && config.theme.length > 0)
    || !(config.group_id === null || typeof config.group_id === "string" && config.group_id.length > 0)
    || !(config.decade === undefined || config.decade === null || [1990, 2000, 2010, 2020].includes(config.decade as number))
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
      && (config.decade === undefined || config.decade === null || question.decades?.includes(config.decade as number))
      && question.play_mode === config.play_mode);
}

export type GridCriterionCategory = "formed_on" | "record_label" | "has_member";

export interface GridCriterion {
  id: string;
  category: GridCriterionCategory;
  label: { "pt-BR": string; en: string };
}

export interface GridEvidence {
  fact_base_id: string;
  locator: string;
  revision_id: number;
  source_key: string;
  source_url: string;
}

export interface GridCellData {
  row_index: number;
  col_index: number;
  valid_entity_ids: string[];
  evidence: GridEvidence[];
}

export interface CandidateEntity {
  id: string;
  canonical_name: string;
  names: { "pt-BR": string; en: string };
}

export interface IntersectionGrid {
  schema_version: "kpop-intersection-grid-v1";
  grid_id: string;
  dataset_version: string;
  reference_date: string;
  dimensions: { rows: 3; cols: 3 };
  row_criteria: GridCriterion[];
  col_criteria: GridCriterion[];
  cells: GridCellData[];
  candidate_pool: CandidateEntity[];
}

const GRID_ROOT_FIELDS = [
  "schema_version",
  "grid_id",
  "dataset_version",
  "reference_date",
  "dimensions",
  "row_criteria",
  "col_criteria",
  "cells",
  "candidate_pool",
];
const GRID_CRITERION_CATEGORIES = new Set<GridCriterionCategory>(["formed_on", "record_label", "has_member"]);
const CRITERION_FIELDS = ["id", "category", "label"];
const BILINGUAL_FIELDS = ["pt-BR", "en"];
const DIMENSIONS_FIELDS = ["rows", "cols"];
const CELL_FIELDS = ["row_index", "col_index", "valid_entity_ids", "evidence"];
const CANDIDATE_FIELDS = ["id", "canonical_name", "names"];
const GRID_EVIDENCE_FIELDS = ["fact_base_id", "locator", "revision_id", "source_key", "source_url"];

export type BilingualText = { "pt-BR": string; en: string };

function isBilingualText(value: unknown): value is BilingualText {
  return isRecord(value)
    && hasExactKeys(value, BILINGUAL_FIELDS)
    && typeof value["pt-BR"] === "string" && value["pt-BR"].length > 0
    && typeof value.en === "string" && value.en.length > 0;
}

function isGridCriterion(value: unknown): value is GridCriterion {
  return isRecord(value)
    && hasExactKeys(value, CRITERION_FIELDS)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.category === "string" && GRID_CRITERION_CATEGORIES.has(value.category as GridCriterionCategory)
    && isBilingualText(value.label);
}

function isCandidate(value: unknown): value is CandidateEntity {
  return isRecord(value)
    && hasExactKeys(value, CANDIDATE_FIELDS)
    && typeof value.id === "string" && QID.test(value.id)
    && typeof value.canonical_name === "string" && value.canonical_name.length > 0
    && isBilingualText(value.names);
}

function isGridEvidence(value: unknown): value is GridEvidence {
  return isRecord(value)
    && hasExactKeys(value, GRID_EVIDENCE_FIELDS)
    && typeof value.fact_base_id === "string" && value.fact_base_id.length > 0
    && typeof value.locator === "string" && value.locator.length > 0
    && Number.isInteger(value.revision_id) && (value.revision_id as number) >= 1
    && typeof value.source_key === "string" && value.source_key.length > 0
    && typeof value.source_url === "string" && value.source_url.startsWith("https://")
    && isHttpsUrl(value.source_url);
}

function isGridCell(value: unknown, candidateQids: Set<string>): value is GridCellData {
  if (!isRecord(value) || !hasExactKeys(value, CELL_FIELDS)) return false;
  const { row_index, col_index, valid_entity_ids, evidence } = value;
  return Number.isInteger(row_index) && (row_index as number) >= 0 && (row_index as number) <= 2
    && Number.isInteger(col_index) && (col_index as number) >= 0 && (col_index as number) <= 2
    && Array.isArray(valid_entity_ids) && valid_entity_ids.length >= 1
    && isStringArray(valid_entity_ids, false)
    && (valid_entity_ids as string[]).every((qid) => QID.test(qid) && candidateQids.has(qid))
    && Array.isArray(evidence) && evidence.length >= 1
    && evidence.every(isGridEvidence);
}

export function isIntersectionGrid(value: unknown): value is IntersectionGrid {
  if (!isRecord(value) || !hasExactKeys(value, GRID_ROOT_FIELDS)) return false;
  if (value.schema_version !== "kpop-intersection-grid-v1"
    || typeof value.grid_id !== "string" || !HASH.test(value.grid_id)
    || typeof value.dataset_version !== "string" || !HASH.test(value.dataset_version)
    || !isDate(value.reference_date)) return false;

  const { dimensions, row_criteria, col_criteria, candidate_pool, cells } = value;
  if (!isRecord(dimensions) || !hasExactKeys(dimensions, DIMENSIONS_FIELDS)
    || !Number.isInteger(dimensions.rows) || dimensions.rows !== 3
    || !Number.isInteger(dimensions.cols) || dimensions.cols !== 3) return false;

  if (!Array.isArray(row_criteria) || row_criteria.length !== 3 || !row_criteria.every(isGridCriterion)) return false;
  if (new Set(row_criteria.map((c) => c.id)).size !== 3) return false;

  if (!Array.isArray(col_criteria) || col_criteria.length !== 3 || !col_criteria.every(isGridCriterion)) return false;
  if (new Set(col_criteria.map((c) => c.id)).size !== 3) return false;

  if (!Array.isArray(candidate_pool) || candidate_pool.length < 1 || !candidate_pool.every(isCandidate)) return false;
  const candidateQids = new Set(candidate_pool.map((c) => c.id));
  if (candidateQids.size !== candidate_pool.length) return false;

  if (!Array.isArray(cells) || cells.length !== 9 || !cells.every((c) => isGridCell(c, candidateQids))) return false;
  const seenCoords = new Set((cells as GridCellData[]).map((c) => `${c.row_index},${c.col_index}`));
  return seenCoords.size === 9;
}

export interface ConnectionsDimensions {
  groups: number;
  items_per_group: number;
  total_items: number;
}

export interface ConnectionsCategory {
  id: string;
  label: BilingualText;
  difficulty_level: 1 | 2 | 3 | 4;
  item_ids: string[];
  explanation: BilingualText;
  evidence: GridEvidence[];
}

export interface ConnectionsItem {
  id: string;
  canonical_name: string;
  labels: BilingualText;
}

export interface ConnectionsPuzzle {
  schema_version: "kpop-connections-puzzle-v1";
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  dimensions: ConnectionsDimensions;
  categories: ConnectionsCategory[];
  items: ConnectionsItem[];
}

const CONNECTIONS_ROOT_FIELDS = [
  "schema_version",
  "puzzle_id",
  "dataset_version",
  "reference_date",
  "dimensions",
  "categories",
  "items",
];
const CONNECTIONS_DIMENSIONS_FIELDS = ["groups", "items_per_group", "total_items"];
const CONNECTIONS_CATEGORY_FIELDS = ["id", "label", "difficulty_level", "item_ids", "explanation", "evidence"];
const CONNECTIONS_ITEM_FIELDS = ["id", "canonical_name", "labels"];

function isConnectionsCategory(value: unknown): value is ConnectionsCategory {
  if (!isRecord(value) || !hasExactKeys(value, CONNECTIONS_CATEGORY_FIELDS)) return false;
  const { id, label, difficulty_level, item_ids, explanation, evidence } = value;
  return typeof id === "string" && id.length > 0
    && isBilingualText(label)
    && isBilingualText(explanation)
    && Number.isInteger(difficulty_level) && (difficulty_level === 1 || difficulty_level === 2 || difficulty_level === 3 || difficulty_level === 4)
    && Array.isArray(item_ids) && item_ids.length === 4
    && item_ids.every((qid) => typeof qid === "string" && QID.test(qid))
    && new Set(item_ids).size === 4
    && Array.isArray(evidence) && evidence.length >= 1
    && evidence.every(isGridEvidence);
}

function isConnectionsItem(value: unknown): value is ConnectionsItem {
  if (!isRecord(value) || !hasExactKeys(value, CONNECTIONS_ITEM_FIELDS)) return false;
  const { id, canonical_name, labels } = value;
  return typeof id === "string" && QID.test(id)
    && typeof canonical_name === "string" && canonical_name.length > 0
    && isBilingualText(labels);
}

export function isConnectionsPuzzle(value: unknown): value is ConnectionsPuzzle {
  if (!isRecord(value) || !hasExactKeys(value, CONNECTIONS_ROOT_FIELDS)) return false;
  if (value.schema_version !== "kpop-connections-puzzle-v1"
    || typeof value.puzzle_id !== "string" || !HASH.test(value.puzzle_id)
    || typeof value.dataset_version !== "string" || !HASH.test(value.dataset_version)
    || !isDate(value.reference_date)) return false;

  const { dimensions, categories, items } = value;
  if (!isRecord(dimensions) || !hasExactKeys(dimensions, CONNECTIONS_DIMENSIONS_FIELDS)
    || dimensions.groups !== 4
    || dimensions.items_per_group !== 4
    || dimensions.total_items !== 16) return false;

  if (!Array.isArray(categories) || categories.length !== 4 || !categories.every(isConnectionsCategory)) return false;
  const categoryIds = new Set(categories.map((c) => c.id));
  if (categoryIds.size !== 4) return false;

  const difficultyLevels = new Set(categories.map((c) => c.difficulty_level));
  if (difficultyLevels.size !== 4) return false;

  if (!Array.isArray(items) || items.length !== 16 || !items.every(isConnectionsItem)) return false;
  const itemIds = new Set(items.map((i) => i.id));
  if (itemIds.size !== 16) return false;

  const categoryItemSets = categories.map((c) => new Set(c.item_ids));
  for (let i = 0; i < categoryItemSets.length; i++) {
    for (let j = i + 1; j < categoryItemSets.length; j++) {
      for (const id of categoryItemSets[i]!) {
        if (categoryItemSets[j]!.has(id)) return false;
      }
    }
  }

  const allCategoryItemIds = new Set(categories.flatMap((c) => c.item_ids));
  if (allCategoryItemIds.size !== 16) return false;
  for (const id of allCategoryItemIds) {
    if (!itemIds.has(id)) return false;
  }

  return true;
}

export interface NameGuessClues {
  debut_year?: number;
  agency?: string | BilingualText;
  members_count?: number;
  description?: BilingualText;
}

export interface NameGuessTarget {
  id: string;
  canonical_name: string;
  normalized_name: string;
  labels: BilingualText;
  entity_type: "group" | "person";
  clues?: NameGuessClues;
  evidence: GridEvidence[];
}

export interface NameGuessPuzzle {
  schema_version: "kpop-name-guess-puzzle-v1";
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  word_length: number;
  max_attempts: number;
  target: NameGuessTarget;
  valid_guesses: string[];
}

const NAME_GUESS_ROOT_FIELDS = [
  "schema_version",
  "puzzle_id",
  "dataset_version",
  "reference_date",
  "word_length",
  "max_attempts",
  "target",
  "valid_guesses",
];

const TARGET_REQUIRED_FIELDS = [
  "id",
  "canonical_name",
  "normalized_name",
  "labels",
  "entity_type",
  "evidence",
];

const CLUES_ALLOWED_FIELDS = ["debut_year", "agency", "members_count", "description"];
const NORMALIZED_NAME_REGEX = /^[A-Z]+$/;

function isNameGuessClues(value: unknown): value is NameGuessClues {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!CLUES_ALLOWED_FIELDS.includes(key)) return false;
  }
  if ("debut_year" in value) {
    const y = value.debut_year;
    if (typeof y !== "number" || !Number.isInteger(y) || y < 1900 || y > 2100) return false;
  }
  if ("agency" in value) {
    const a = value.agency;
    if (typeof a !== "string" && !isBilingualText(a)) return false;
    if (typeof a === "string" && a.length === 0) return false;
  }
  if ("members_count" in value) {
    const m = value.members_count;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 50) return false;
  }
  if ("description" in value && !isBilingualText(value.description)) {
    return false;
  }
  return true;
}

function isNameGuessTarget(value: unknown, wordLength: number): value is NameGuessTarget {
  if (!isRecord(value)) return false;
  for (const req of TARGET_REQUIRED_FIELDS) {
    if (!(req in value)) return false;
  }
  const allowed = new Set([...TARGET_REQUIRED_FIELDS, "clues"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return false;
  }
  const { id, canonical_name, normalized_name, labels, entity_type, evidence } = value;
  if (typeof id !== "string" || !QID.test(id)) return false;
  if (typeof canonical_name !== "string" || canonical_name.length === 0) return false;
  if (
    typeof normalized_name !== "string"
    || !NORMALIZED_NAME_REGEX.test(normalized_name)
    || normalized_name.length !== wordLength
  ) {
    return false;
  }
  if (!isBilingualText(labels)) return false;
  if (entity_type !== "group" && entity_type !== "person") return false;
  if (!Array.isArray(evidence) || evidence.length < 1 || !evidence.every(isGridEvidence)) {
    return false;
  }
  if ("clues" in value && !isNameGuessClues(value.clues)) {
    return false;
  }
  return true;
}

export function isNameGuessPuzzle(value: unknown): value is NameGuessPuzzle {
  if (!isRecord(value) || !hasExactKeys(value, NAME_GUESS_ROOT_FIELDS)) return false;
  if (
    value.schema_version !== "kpop-name-guess-puzzle-v1"
    || typeof value.puzzle_id !== "string" || !HASH.test(value.puzzle_id)
    || typeof value.dataset_version !== "string" || !HASH.test(value.dataset_version)
    || !isDate(value.reference_date)
  ) {
    return false;
  }

  const { word_length, max_attempts, target, valid_guesses } = value;
  if (
    typeof word_length !== "number"
    || !Number.isInteger(word_length)
    || word_length < 3
    || word_length > 10
  ) {
    return false;
  }
  if (
    typeof max_attempts !== "number"
    || !Number.isInteger(max_attempts)
    || max_attempts < 4
    || max_attempts > 8
  ) {
    return false;
  }

  if (!isNameGuessTarget(target, word_length)) return false;

  if (
    !Array.isArray(valid_guesses)
    || valid_guesses.length < 1
    || new Set(valid_guesses).size !== valid_guesses.length
  ) {
    return false;
  }

  for (const guess of valid_guesses) {
    if (
      typeof guess !== "string"
      || guess.length !== word_length
      || !NORMALIZED_NAME_REGEX.test(guess)
    ) {
      return false;
    }
  }

  if (!valid_guesses.includes(target.normalized_name)) {
    return false;
  }

  return true;
}

export {
  isWordSearchPuzzle,
  type WordSearchDimensions,
  type WordSearchWord,
  type WordSearchPuzzle,
} from "./word-search-types";
