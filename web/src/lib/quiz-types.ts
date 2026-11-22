import {
  hasDistinctItems,
  hasExactKeys,
  isHash,
  isIntegerInRange,
  isIsoDate,
  isNonBlankString,
  isNonEmptyString,
  isQid,
  isRecord,
  isStringList,
} from "./guards";
import { isHttpsUrl } from "./https-url";

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
  /**
   * Present on client-built catalog rounds (Q03). Omitted on published session
   * artifacts. Additive for Q04 local saves: older saves without the field stay
   * readable.
   */
  catalog_version?: string;
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

const QUIZ_DECADES = [1990, 2000, 2010, 2020];
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

function isDistinctStringList(value: unknown, allowEmpty = true): value is string[] {
  return isStringList(value)
    && (allowEmpty || value.length > 0)
    && hasDistinctItems(value);
}

function citesEveryFact(evidence: Evidence[], factBaseIds: string[]): boolean {
  return new Set(evidence.map((item) => item.fact_base_id)).size === factBaseIds.length;
}

function isOption(value: unknown): value is QuizOption {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "label", "value", "value_type"])) return false;
  return isHash(value.id)
    && isNonEmptyString(value.label)
    && isNonEmptyString(value.value)
    && typeof value.value_type === "string" && VALUE_TYPES.has(value.value_type as ValueType);
}

function isEvidence(value: unknown, factBaseIds: string[]): value is Evidence {
  if (!isRecord(value) || !hasExactKeys(value, ["fact_base_id", "locator", "revision_id", "source_key", "source_url"])) return false;
  return typeof value.fact_base_id === "string" && factBaseIds.includes(value.fact_base_id)
    && isNonEmptyString(value.locator)
    && isIntegerInRange(value.revision_id, 1)
    && isNonEmptyString(value.source_key)
    && isHttpsUrl(value.source_url);
}

function isClue(value: unknown): value is QuizClue {
  if (!isRecord(value) || !hasExactKeys(value, ["evidence", "fact_base_ids", "id", "text", "type"])) return false;
  if (!isHash(value.id) || value.type !== "decade" || !isNonEmptyString(value.text)
    || !isDistinctStringList(value.fact_base_ids, false)
    || !Array.isArray(value.evidence)) return false;
  const factBaseIds = value.fact_base_ids;
  return value.evidence.every((item) => isEvidence(item, factBaseIds))
    && citesEveryFact(value.evidence as Evidence[], factBaseIds);
}

const PERMITTED_LICENSES = new Set([
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

export function isLicensedMedia(value: unknown): value is LicensedMedia {
  if (!isRecord(value) || !hasExactKeys(value, LICENSED_MEDIA_FIELDS)) return false;
  return isHttpsUrl(value.asset_url)
    && isHttpsUrl(value.source_url)
    && isNonBlankString(value.creator)
    && typeof value.license_name === "string" && PERMITTED_LICENSES.has(value.license_name)
    && isHttpsUrl(value.license_url)
    && isQid(value.subject_qid)
    && isIsoDate(value.verified_at)
    && isDistinctStringList(value.transformations, false);
}

function isDecadeList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((decade) => Number.isInteger(decade) && QUIZ_DECADES.includes(decade))
    && hasDistinctItems(value)
    && !value.some((decade, index) => index > 0 && value[index - 1] > decade);
}

function hasValidOptionalFields(value: Record<string, unknown>): boolean {
  if (Object.hasOwn(value, "media") && value.media !== null && !isLicensedMedia(value.media)) return false;
  if (Object.hasOwn(value, "group_relevance_score")
    && value.group_relevance_score !== null
    && !isIntegerInRange(value.group_relevance_score, 0, 10_000)) return false;
  return !Object.hasOwn(value, "decades") || isDecadeList(value.decades);
}

function hasQuestionIdentity(value: Record<string, unknown>, locale: Locale): boolean {
  return isHash(value.id)
    && isHash(value.logical_id)
    && isHash(value.base_logical_id)
    && isHash(value.semantic_id)
    && value.language === locale
    && typeof value.type === "string" && QUESTION_TYPES.has(value.type)
    && isNonEmptyString(value.theme)
    && typeof value.play_mode === "string" && PLAY_MODES.has(value.play_mode as PlayMode)
    && typeof value.challenge_rating === "string" && RATINGS.has(value.challenge_rating as ChallengeRating);
}

function hasQuestionContent(value: Record<string, unknown>): boolean {
  return isIntegerInRange(value.base_points, 1)
    && isIntegerInRange(value.hint_cost, 0)
    && isNonEmptyString(value.prompt)
    && isNonEmptyString(value.explanation)
    && isIsoDate(value.reference_date)
    && isDistinctStringList(value.fact_base_ids, false)
    && isDistinctStringList(value.group_ids);
}

function hasValidClues(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.clues_available)
    || !value.clues_available.every(isClue)
    || !isDistinctStringList(value.clues_shown)) return false;
  const clueIds = (value.clues_available as QuizClue[]).map((clue) => clue.id);
  const shown = value.clues_shown;
  return hasDistinctItems(clueIds)
    && shown.every((id) => clueIds.includes(id))
    && (value.play_mode === "assisted" || shown.length === 0)
    && (value.play_mode !== "expert" || clueIds.length === 0);
}

function hasValidOptions(value: Record<string, unknown>): boolean {
  const { options } = value;
  if (!Array.isArray(options) || options.length !== 4 || !options.every(isOption)) return false;
  const optionIds = options.map((option) => option.id);
  return hasDistinctItems(optionIds)
    && hasDistinctItems(options.map((option) => option.label))
    && hasDistinctItems(options.map((option) => option.value))
    && new Set(options.map((option) => option.value_type)).size === 1
    && typeof value.answer_option_id === "string"
    && optionIds.includes(value.answer_option_id);
}

function hasQuestionEvidence(value: Record<string, unknown>): boolean {
  const factBaseIds = value.fact_base_ids as string[];
  return Array.isArray(value.evidence)
    && value.evidence.length > 0
    && value.evidence.every((item) => isEvidence(item, factBaseIds))
    && citesEveryFact(value.evidence as Evidence[], factBaseIds);
}

export function isQuestion(value: unknown, locale: Locale): value is QuizQuestion {
  return isRecord(value)
    && hasExactKeys(value, QUESTION_FIELDS, QUESTION_OPTIONAL_FIELDS)
    && hasValidOptionalFields(value)
    && hasQuestionIdentity(value, locale)
    && hasQuestionContent(value)
    && hasValidClues(value)
    && hasValidOptions(value)
    && hasQuestionEvidence(value);
}

function hasSessionIdentity(value: Record<string, unknown>): boolean {
  return value.schema_version === "kpop-quiz-session-v2"
    && isHash(value.dataset_version)
    && isHash(value.session_id)
    && (value.catalog_version === undefined || isHash(value.catalog_version));
}

function isSessionConfig(config: Record<string, unknown>): boolean {
  return (config.language === "pt-BR" || config.language === "en")
    && typeof config.seed === "string"
    && (config.theme === null || isNonEmptyString(config.theme))
    && (config.group_id === null || isNonEmptyString(config.group_id))
    && (config.decade === undefined || config.decade === null || QUIZ_DECADES.includes(config.decade as number))
    && typeof config.play_mode === "string" && PLAY_MODES.has(config.play_mode as PlayMode)
    && (config.timer_seconds === null || isIntegerInRange(config.timer_seconds, 1));
}

function questionsMatchConfig(questions: QuizQuestion[], config: Record<string, unknown>): boolean {
  return hasDistinctItems(questions.map((question) => question.id))
    && hasDistinctItems(questions.map((question) => question.semantic_id))
    && questions.every((question) => (config.theme === null || question.theme === config.theme)
      && (config.group_id === null || question.group_ids.includes(config.group_id as string))
      && (config.decade === undefined || config.decade === null || question.decades?.includes(config.decade as number))
      && question.play_mode === config.play_mode);
}

export function isQuizSession(value: unknown): value is QuizSession {
  if (!isRecord(value) || !hasExactKeys(value, SESSION_FIELDS, ["catalog_version"])) return false;
  const { config } = value;
  if (!isRecord(config) || !hasExactKeys(config, CONFIG_FIELDS, ["decade"])) return false;
  if (!hasSessionIdentity(value) || !isSessionConfig(config)) return false;
  if (!Array.isArray(value.questions) || value.questions.length !== 10) return false;
  const locale = config.language as Locale;
  if (!value.questions.every((question) => isQuestion(question, locale))) return false;
  return questionsMatchConfig(value.questions as QuizQuestion[], config);
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
  /**
   * Other names of the group in its Wikidata entity snapshot (labels in
   * other languages, alternative labels, native names), for search only.
   * Grids published before the field existed lack it.
   */
  aliases?: string[];
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
    && isNonEmptyString(value["pt-BR"])
    && isNonEmptyString(value.en);
}

function isGridCriterion(value: unknown): value is GridCriterion {
  return isRecord(value)
    && hasExactKeys(value, CRITERION_FIELDS)
    && isNonEmptyString(value.id)
    && typeof value.category === "string" && GRID_CRITERION_CATEGORIES.has(value.category as GridCriterionCategory)
    && isBilingualText(value.label);
}

function isCandidate(value: unknown): value is CandidateEntity {
  return isRecord(value)
    && hasExactKeys(value, CANDIDATE_FIELDS, ["aliases"])
    && (value.aliases === undefined || isAliasList(value.aliases))
    && isQid(value.id)
    && isNonEmptyString(value.canonical_name)
    && isBilingualText(value.names);
}

function isAliasList(value: unknown): value is string[] {
  return isStringList(value, isNonBlankString) && hasDistinctItems(value);
}

function isGridEvidence(value: unknown): value is GridEvidence {
  return isRecord(value)
    && hasExactKeys(value, GRID_EVIDENCE_FIELDS)
    && isNonEmptyString(value.fact_base_id)
    && isNonEmptyString(value.locator)
    && isIntegerInRange(value.revision_id, 1)
    && isNonEmptyString(value.source_key)
    && isHttpsUrl(value.source_url);
}

function isGridCell(value: unknown, candidateQids: Set<string>): value is GridCellData {
  if (!isRecord(value) || !hasExactKeys(value, CELL_FIELDS)) return false;
  const { row_index, col_index, valid_entity_ids, evidence } = value;
  return isIntegerInRange(row_index, 0, 2)
    && isIntegerInRange(col_index, 0, 2)
    && isDistinctStringList(valid_entity_ids, false)
    && valid_entity_ids.every((qid) => isQid(qid) && candidateQids.has(qid))
    && Array.isArray(evidence) && evidence.length >= 1
    && evidence.every(isGridEvidence);
}

function isGridDimensions(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, DIMENSIONS_FIELDS)
    && value.rows === 3
    && value.cols === 3;
}

function isCriteriaLine(value: unknown): value is GridCriterion[] {
  return Array.isArray(value)
    && value.length === 3
    && value.every(isGridCriterion)
    && new Set(value.map((criterion: GridCriterion) => criterion.id)).size === 3;
}

export function isIntersectionGrid(value: unknown): value is IntersectionGrid {
  if (!isRecord(value) || !hasExactKeys(value, GRID_ROOT_FIELDS)) return false;
  if (value.schema_version !== "kpop-intersection-grid-v1"
    || !isHash(value.grid_id)
    || !isHash(value.dataset_version)
    || !isIsoDate(value.reference_date)) return false;

  const { dimensions, row_criteria, col_criteria, candidate_pool, cells } = value;
  if (!isGridDimensions(dimensions)) return false;

  if (!isCriteriaLine(row_criteria) || !isCriteriaLine(col_criteria)) return false;

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
  return isNonEmptyString(id)
    && isBilingualText(label)
    && isBilingualText(explanation)
    && isIntegerInRange(difficulty_level, 1, 4)
    && isStringList(item_ids, isQid) && item_ids.length === 4
    && hasDistinctItems(item_ids)
    && Array.isArray(evidence) && evidence.length >= 1
    && evidence.every(isGridEvidence);
}

function isConnectionsItem(value: unknown): value is ConnectionsItem {
  if (!isRecord(value) || !hasExactKeys(value, CONNECTIONS_ITEM_FIELDS)) return false;
  const { id, canonical_name, labels } = value;
  return isQid(id)
    && isNonEmptyString(canonical_name)
    && isBilingualText(labels);
}

function isConnectionsDimensions(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, CONNECTIONS_DIMENSIONS_FIELDS)
    && value.groups === 4
    && value.items_per_group === 4
    && value.total_items === 16;
}

function categoriesPartitionItems(categories: ConnectionsCategory[], itemIds: Set<string>): boolean {
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

export function isConnectionsPuzzle(value: unknown): value is ConnectionsPuzzle {
  if (!isRecord(value) || !hasExactKeys(value, CONNECTIONS_ROOT_FIELDS)) return false;
  if (value.schema_version !== "kpop-connections-puzzle-v1"
    || !isHash(value.puzzle_id)
    || !isHash(value.dataset_version)
    || !isIsoDate(value.reference_date)) return false;

  const { dimensions, categories, items } = value;
  if (!isConnectionsDimensions(dimensions)) return false;

  if (!Array.isArray(categories) || categories.length !== 4 || !categories.every(isConnectionsCategory)) return false;
  const categoryIds = new Set(categories.map((c) => c.id));
  if (categoryIds.size !== 4) return false;

  const difficultyLevels = new Set(categories.map((c) => c.difficulty_level));
  if (difficultyLevels.size !== 4) return false;

  if (!Array.isArray(items) || items.length !== 16 || !items.every(isConnectionsItem)) return false;
  const itemIds = new Set(items.map((i) => i.id));
  if (itemIds.size !== 16) return false;

  return categoriesPartitionItems(categories, itemIds);
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

function isAgency(value: unknown): boolean {
  return isNonEmptyString(value) || isBilingualText(value);
}

function isNameGuessClues(value: unknown): value is NameGuessClues {
  if (!isRecord(value) || !hasExactKeys(value, [], CLUES_ALLOWED_FIELDS)) return false;
  if ("debut_year" in value && !isIntegerInRange(value.debut_year, 1900, 2100)) return false;
  if ("agency" in value && !isAgency(value.agency)) return false;
  if ("members_count" in value && !isIntegerInRange(value.members_count, 1, 50)) return false;
  return !("description" in value) || isBilingualText(value.description);
}

function isNormalizedName(value: unknown, wordLength: number): value is string {
  return typeof value === "string"
    && NORMALIZED_NAME_REGEX.test(value)
    && value.length === wordLength;
}

function isNameGuessTarget(value: unknown, wordLength: number): value is NameGuessTarget {
  if (!isRecord(value) || !hasExactKeys(value, TARGET_REQUIRED_FIELDS, ["clues"])) return false;
  const { id, canonical_name, normalized_name, labels, entity_type, evidence } = value;
  return isQid(id)
    && isNonEmptyString(canonical_name)
    && isNormalizedName(normalized_name, wordLength)
    && isBilingualText(labels)
    && (entity_type === "group" || entity_type === "person")
    && Array.isArray(evidence) && evidence.length >= 1 && evidence.every(isGridEvidence)
    && (!("clues" in value) || isNameGuessClues(value.clues));
}

export function isNameGuessPuzzle(value: unknown): value is NameGuessPuzzle {
  if (!isRecord(value) || !hasExactKeys(value, NAME_GUESS_ROOT_FIELDS)) return false;
  if (
    value.schema_version !== "kpop-name-guess-puzzle-v1"
    || !isHash(value.puzzle_id)
    || !isHash(value.dataset_version)
    || !isIsoDate(value.reference_date)
  ) {
    return false;
  }

  const { word_length, max_attempts, target, valid_guesses } = value;
  if (!isIntegerInRange(word_length, 3, 10) || !isIntegerInRange(max_attempts, 4, 8)) return false;
  if (!isNameGuessTarget(target, word_length)) return false;
  if (!Array.isArray(valid_guesses) || valid_guesses.length < 1 || !hasDistinctItems(valid_guesses)) return false;
  for (const guess of valid_guesses) {
    if (!isNormalizedName(guess, word_length)) return false;
  }
  return valid_guesses.includes(target.normalized_name);
}

export {
  isWordSearchPuzzle,
  type WordSearchDimensions,
  type WordSearchWord,
  type WordSearchPuzzle,
} from "./word-search-types";

export {
  isTimelinePuzzle,
  type TimelineEventType,
  type TimelineEvidence,
  type TimelineEvent,
  type TimelinePuzzle,
} from "./timeline-types";
