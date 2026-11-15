import eventData from "../../../data/map-pilot/deadline-events.json";
import worldMap from "./map-pilot/world-map.json";
import { ISO_DATE_PATTERN, isNonBlankString, isRecord, matchesPattern } from "../lib/guards";
import { isHttpsUrl } from "../lib/https-url";

export interface MapPilotEvent {
  subject_wikidata_id: string;
  predicate: "announced_performance_city";
  artist_musicbrainz_mbid: string;
  event_mbid: string;
  event_date: string;
  event_type: "concert";
  schedule_status: "listed";
  billing_role: "headliner" | "co_headliner";
  tour_mbid: string;
  place_mbid: string;
  city_area_mbid: string;
  city_area_type: string;
  country_wikidata_id: string;
  country_iso_3166_1: string;
  country_check_wikidata_id: string;
  country_check_wikidata_revid: number;
  map_feature_id: string;
  map_dataset: string;
  map_dataset_version: string;
  map_scale: string;
  source_url: string;
  source_locator: string;
  source_checked_at: string;
  musicbrainz_event_url: string;
  status: "accepted";
}

export interface MapPilotCountry {
  wikidata_id: string;
  iso_3166_1: string;
  map_feature_id: string;
  label: string;
}

interface MapPilotDataset {
  schema_version: string;
  reference_date: string;
  country_crosswalk_id: string;
  events: MapPilotEvent[];
  countries: Array<Omit<MapPilotCountry, "label">>;
}

interface WorldMap {
  schema_version: string;
  dataset: { name: string; version: string; scale: string; credit: string };
  view_box: string;
  features: Array<{ id: string; label: string; path: string }>;
}

const data = eventData as MapPilotDataset;
const map = worldMap as WorldMap;
const mapFeatures = new Map(map.features.map((feature) => [feature.id, feature]));

export const mapPilotEvents = data.events;
export const mapPilotCountries: MapPilotCountry[] = data.countries.flatMap((country) => {
  const feature = mapFeatures.get(country.map_feature_id);
  return feature ? [{ ...country, label: feature.label }] : [];
});
export const mapPilotFeatures = map.features;
export const mapPilotMetadata = {
  referenceDate: data.reference_date,
  crosswalkId: data.country_crosswalk_id,
  mapCredit: map.dataset.credit,
  mapSource: map.dataset.name,
  mapVersion: map.dataset.version,
  mapScale: map.dataset.scale,
};

const PORTUGUESE_COUNTRY_LABELS: Record<string, string> = {
  CA: "Canadá",
  CN: "China",
  FR: "França",
  GB: "Reino Unido",
  ID: "Indonésia",
  IT: "Itália",
  JP: "Japão",
  KR: "Coreia do Sul",
  PH: "Filipinas",
  SG: "Singapura",
  ES: "Espanha",
  TW: "Taiwan",
  TH: "Tailândia",
  US: "Estados Unidos",
};

export function mapPilotCountryLabel(country: MapPilotCountry, locale: "pt-BR" | "en"): string {
  return locale === "pt-BR"
    ? PORTUGUESE_COUNTRY_LABELS[country.iso_3166_1] ?? country.label
    : country.label;
}

/**
 * A YYYY-MM-DD date that reads back the same through Date. Unlike `isIsoDate`
 * in the shared guards, it accepts the years 0000 to 0099.
 */
function isParsedIsoDate(value: unknown): value is string {
  if (!matchesPattern(value, ISO_DATE_PATTERN)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** A listed concert the artist headlines. It accepts extra keys. */
function isListedConcert(event: Record<string, unknown>): boolean {
  return event.predicate === "announced_performance_city"
    && event.schedule_status === "listed"
    && event.status === "accepted"
    && event.event_type === "concert"
    && (event.billing_role === "headliner" || event.billing_role === "co_headliner")
    && isParsedIsoDate(event.event_date);
}

/** The ids that place the event on the map, and the sources that cite it. */
function hasEventPlaceAndSources(event: Record<string, unknown>): boolean {
  return isParsedIsoDate(event.source_checked_at)
    && typeof event.event_mbid === "string"
    && typeof event.country_wikidata_id === "string"
    && typeof event.country_iso_3166_1 === "string"
    && typeof event.map_feature_id === "string"
    && isNonBlankString(event.source_locator)
    && isHttpsUrl(event.source_url)
    && isHttpsUrl(event.musicbrainz_event_url);
}

function isMapPilotEvent(value: unknown): value is Record<string, unknown> & { event_mbid: string } {
  return isRecord(value) && isListedConcert(value) && hasEventPlaceAndSources(value);
}

function isMapPilotCountry(value: unknown): value is Omit<MapPilotCountry, "label"> {
  return isRecord(value)
    && typeof value.wikidata_id === "string"
    && typeof value.iso_3166_1 === "string"
    && typeof value.map_feature_id === "string";
}

export function isMapPilotDataset(value: unknown): value is MapPilotDataset {
  if (!isRecord(value)) return false;
  if (
    value.schema_version !== "kpop-map-pilot-events-v2"
    || !isParsedIsoDate(value.reference_date)
    || typeof value.country_crosswalk_id !== "string"
    || !Array.isArray(value.events)
    || value.events.length === 0
    || !Array.isArray(value.countries)
  ) return false;

  const eventIds = new Set<string>();
  for (const event of value.events) {
    if (!isMapPilotEvent(event) || eventIds.has(event.event_mbid)) return false;
    eventIds.add(event.event_mbid);
  }

  const countryIds = new Set<string>();
  for (const country of value.countries) {
    if (!isMapPilotCountry(country) || countryIds.has(country.map_feature_id)) return false;
    countryIds.add(country.map_feature_id);
  }

  return value.events.every((event) => isRecord(event) && countryIds.has(String(event.map_feature_id)));
}

function dateSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectMapPilotRound(
  events: readonly MapPilotEvent[],
  seedDate: string,
  size = 10,
): MapPilotEvent[] {
  const shuffled = [...events];
  let state = dateSeed(seedDate) || 1;
  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled.slice(0, Math.min(size, shuffled.length));
}

export function isBundledMapPilotDatasetValid(): boolean {
  return isMapPilotDataset(eventData);
}
