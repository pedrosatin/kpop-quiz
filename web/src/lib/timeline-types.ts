import {
  hasExactKeys,
  isHash,
  isIntegerInRange,
  isIsoDate,
  isNonBlankString,
  isNonEmptyString,
  isQid,
  isRecord,
} from "./guards";
import { isHttpsUrl } from "./https-url";

export type TimelineEventType =
  | "debut"
  | "formation"
  | "member_join"
  | "disbandment"
  | "birth"
  | "release";

export type TimelineSchemaVersion = "kpop-timeline-puzzle-v1" | "kpop-timeline-puzzle-v2";

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
  schema_version: TimelineSchemaVersion;
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  theme: BilingualText;
  theme_description: BilingualText;
  events: TimelineEvent[];
}

const TIMELINE_DATE_REGEX = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const TIMELINE_MIN_YEAR = 1980;
const TIMELINE_MAX_YEAR = 2035;

const TIMELINE_V1_EVENT_TYPES: readonly TimelineEventType[] = [
  "debut",
  "formation",
  "member_join",
  "disbandment",
  "birth",
];

const TIMELINE_EVENT_TYPES_BY_VERSION: Record<TimelineSchemaVersion, ReadonlySet<string>> = {
  "kpop-timeline-puzzle-v1": new Set(TIMELINE_V1_EVENT_TYPES),
  "kpop-timeline-puzzle-v2": new Set([...TIMELINE_V1_EVENT_TYPES, "release"]),
};

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

function isBilingualText(value: unknown): value is BilingualText {
  return isRecord(value)
    && hasExactKeys(value, BILINGUAL_KEYS)
    && isNonBlankString(value["pt-BR"])
    && isNonBlankString(value.en);
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

function isTimelineEvidence(value: unknown): value is TimelineEvidence {
  return isRecord(value)
    && hasExactKeys(value, EVIDENCE_REQUIRED_KEYS)
    && isNonEmptyString(value.fact_base_id)
    && isNonEmptyString(value.locator)
    && isIntegerInRange(value.revision_id, 1)
    && isNonEmptyString(value.source_key)
    && isHttpsUrl(value.source_url);
}

function isTimelineEvent(value: unknown, eventTypes: ReadonlySet<string>): value is TimelineEvent {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_REQUIRED_KEYS)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.event_type !== "string" || !eventTypes.has(value.event_type)) return false;
  if (!isValidTimelineDate(value.date)) return false;
  if (!isIntegerInRange(value.year, TIMELINE_MIN_YEAR, TIMELINE_MAX_YEAR)) return false;
  const dateYear = parseInt(value.date.split("-")[0]!, 10);
  if (dateYear !== value.year) return false;

  return isBilingualText(value.display_date)
    && isBilingualText(value.title)
    && isBilingualText(value.description)
    && isQid(value.entity_id)
    && isNonEmptyString(value.entity_name)
    && Array.isArray(value.evidence)
    && value.evidence.length >= 1
    && value.evidence.every(isTimelineEvidence);
}

export function isTimelinePuzzle(value: unknown): value is TimelinePuzzle {
  if (!isRecord(value) || !hasExactKeys(value, TIMELINE_ROOT_KEYS)) return false;

  if (
    typeof value.schema_version !== "string"
    || !Object.hasOwn(TIMELINE_EVENT_TYPES_BY_VERSION, value.schema_version)
  ) {
    return false;
  }
  const eventTypes = TIMELINE_EVENT_TYPES_BY_VERSION[value.schema_version as TimelineSchemaVersion];
  if (!isHash(value.puzzle_id) || !isHash(value.dataset_version)) return false;
  if (!isIsoDate(value.reference_date)) return false;
  if (!isBilingualText(value.theme)) return false;
  if (!isBilingualText(value.theme_description)) return false;

  if (!Array.isArray(value.events) || value.events.length < 4 || value.events.length > 6) return false;
  if (!value.events.every((event) => isTimelineEvent(event, eventTypes))) return false;

  const seenIds = new Set<string>();
  for (const ev of value.events) {
    if (seenIds.has(ev.id)) return false;
    seenIds.add(ev.id);
  }

  return true;
}
