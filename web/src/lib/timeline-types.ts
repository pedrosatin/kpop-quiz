export type TimelineEventType =
  | "debut"
  | "formation"
  | "member_join"
  | "disbandment"
  | "birth";

export interface BilingualText {
  "pt-BR": string;
  en: string;
}

export interface TimelineEvidence {
  fact_base_id: string;
  locator: string;
  revision_id: number;
  source_key: string;
  source_url: string;
}

export interface TimelineEvent {
  id: string;
  event_type: TimelineEventType;
  date: string;
  year: number;
  display_date: BilingualText;
  title: BilingualText;
  description: BilingualText;
  entity_id: string;
  entity_name: string;
  evidence: TimelineEvidence[];
}

export interface TimelinePuzzle {
  schema_version: "kpop-timeline-puzzle-v1";
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  theme: BilingualText;
  theme_description: BilingualText;
  events: TimelineEvent[];
}

const HASH_REGEX = /^[0-9a-f]{64}$/;
const QID_REGEX = /^Q[1-9][0-9]*$/;
const REFERENCE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIMELINE_DATE_REGEX = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const TIMELINE_MIN_YEAR = 1980;
const TIMELINE_MAX_YEAR = 2035;

const TIMELINE_EVENT_TYPES = new Set<TimelineEventType>([
  "debut",
  "formation",
  "member_join",
  "disbandment",
  "birth",
]);

const BILINGUAL_KEYS = ["pt-BR", "en"] as const;

const TIMELINE_ROOT_KEYS = [
  "schema_version",
  "puzzle_id",
  "dataset_version",
  "reference_date",
  "theme",
  "theme_description",
  "events",
] as const;

const EVENT_REQUIRED_KEYS = [
  "id",
  "event_type",
  "date",
  "year",
  "display_date",
  "title",
  "description",
  "entity_id",
  "entity_name",
  "evidence",
];

const EVIDENCE_REQUIRED_KEYS = [
  "fact_base_id",
  "locator",
  "revision_id",
  "source_key",
  "source_url",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((f) => Object.hasOwn(value, f));
}

function isBilingualText(value: unknown): value is BilingualText {
  if (!isRecord(value) || !hasExactKeys(value, BILINGUAL_KEYS)) return false;
  return (
    typeof value["pt-BR"] === "string" &&
    value["pt-BR"].trim().length > 0 &&
    typeof value.en === "string" &&
    value.en.trim().length > 0
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidTimelineDate(value: unknown): value is string {
  if (typeof value !== "string" || !TIMELINE_DATE_REGEX.test(value)) return false;
  const parts = value.split("-").map(Number);
  const year = parts[0]!;
  if (year < TIMELINE_MIN_YEAR || year > TIMELINE_MAX_YEAR) return false;
  if (parts.length >= 2) {
    const month = parts[1]!;
    if (month < 1 || month > 12) return false;
  }
  if (parts.length === 3) {
    const month = parts[1]!;
    const day = parts[2]!;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return false;
    }
  }
  return true;
}

function isValidReferenceDate(value: unknown): value is string {
  if (typeof value !== "string" || !REFERENCE_DATE_REGEX.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

function isTimelineEvidence(value: unknown): value is TimelineEvidence {
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_REQUIRED_KEYS)) return false;
  return (
    typeof value.fact_base_id === "string" &&
    value.fact_base_id.length > 0 &&
    typeof value.locator === "string" &&
    value.locator.length > 0 &&
    typeof value.revision_id === "number" &&
    Number.isInteger(value.revision_id) &&
    value.revision_id >= 1 &&
    typeof value.source_key === "string" &&
    value.source_key.length > 0 &&
    isHttpsUrl(value.source_url)
  );
}

function isTimelineEvent(value: unknown): value is TimelineEvent {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_REQUIRED_KEYS)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.event_type !== "string" || !TIMELINE_EVENT_TYPES.has(value.event_type as TimelineEventType)) {
    return false;
  }
  if (!isValidTimelineDate(value.date)) return false;
  if (
    typeof value.year !== "number" ||
    !Number.isInteger(value.year) ||
    value.year < TIMELINE_MIN_YEAR ||
    value.year > TIMELINE_MAX_YEAR
  ) {
    return false;
  }
  const dateYear = parseInt(value.date.split("-")[0]!, 10);
  if (dateYear !== value.year) return false;

  if (!isBilingualText(value.display_date)) return false;
  if (!isBilingualText(value.title)) return false;
  if (!isBilingualText(value.description)) return false;
  if (typeof value.entity_id !== "string" || !QID_REGEX.test(value.entity_id)) return false;
  if (typeof value.entity_name !== "string" || value.entity_name.length === 0) return false;
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || !value.evidence.every(isTimelineEvidence)) {
    return false;
  }
  return true;
}

export function isTimelinePuzzle(value: unknown): value is TimelinePuzzle {
  if (!isRecord(value) || !hasExactKeys(value, TIMELINE_ROOT_KEYS)) return false;

  if (value.schema_version !== "kpop-timeline-puzzle-v1") return false;
  if (typeof value.puzzle_id !== "string" || !HASH_REGEX.test(value.puzzle_id)) return false;
  if (typeof value.dataset_version !== "string" || !HASH_REGEX.test(value.dataset_version)) return false;
  if (!isValidReferenceDate(value.reference_date)) return false;
  if (!isBilingualText(value.theme)) return false;
  if (!isBilingualText(value.theme_description)) return false;

  if (!Array.isArray(value.events) || value.events.length < 4 || value.events.length > 6) return false;
  if (!value.events.every(isTimelineEvent)) return false;

  const seenIds = new Set<string>();
  for (const ev of value.events) {
    if (seenIds.has(ev.id)) return false;
    seenIds.add(ev.id);
  }

  return true;
}
