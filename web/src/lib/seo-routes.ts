import type { Locale } from "./quiz-types";
import type { Messages, SeoRouteKey } from "../i18n/catalog";
import {
  GROUP_PAGES,
  groupPageKey,
  groupPagePath,
  isGroupPageKey,
  type GroupPageKey,
} from "./group-pages";

export const SEO_PROD_ORIGIN = "https://kpopquiz.online";
export const SEO_DEFAULT_PATH = "/en/";

export const SEO_OG_IMAGE_DIR = "/og/";
export const SEO_OG_IMAGE_WIDTH = 1200;
export const SEO_OG_IMAGE_HEIGHT = 630;

/** Game routes plus published group landing pages (ADR 045). */
export type IndexableRouteKey = SeoRouteKey | GroupPageKey;

export interface SeoRoute<K extends IndexableRouteKey = IndexableRouteKey> {
  key: K;
  locale: Locale;
  path: string;
  alternatePath: string;
}

function pair(
  key: SeoRouteKey,
  ptPath: string,
  enPath: string,
): [SeoRoute<SeoRouteKey>, SeoRoute<SeoRouteKey>] {
  return [
    { key, locale: "pt-BR", path: ptPath, alternatePath: enPath },
    { key, locale: "en", path: enPath, alternatePath: ptPath },
  ];
}

function groupPair(slug: string): [SeoRoute<GroupPageKey>, SeoRoute<GroupPageKey>] {
  const key = groupPageKey(slug);
  const ptPath = groupPagePath(slug, "pt-BR");
  const enPath = groupPagePath(slug, "en");
  return [
    { key, locale: "pt-BR", path: ptPath, alternatePath: enPath },
    { key, locale: "en", path: enPath, alternatePath: ptPath },
  ];
}

export const SEO_ROUTES: readonly SeoRoute<SeoRouteKey>[] = [
  ...pair("quiz", "/pt-br/", "/en/"),
  ...pair("grid", "/pt-br/grid/", "/en/grid/"),
  ...pair("connections", "/pt-br/conexoes/", "/en/connections/"),
  ...pair("nameGuess", "/pt-br/adivinhe/", "/en/guess/"),
  ...pair("wordSearch", "/pt-br/caca-palavras/", "/en/word-search/"),
  ...pair("mapPilot", "/pt-br/mapa/", "/en/map/"),
  ...pair("timeline", "/pt-br/linha-do-tempo/", "/en/timeline/"),
  ...pair("code", "/pt-br/codigo/", "/en/code/"),
  ...pair("crossword", "/pt-br/cruzadinha/", "/en/crossword/"),
  ...pair("strands", "/pt-br/palavras-conectadas/", "/en/strands/"),
];

/** Indexable SEO routes for every published group page (both locales). */
export const GROUP_SEO_ROUTES: readonly SeoRoute<GroupPageKey>[] = GROUP_PAGES.flatMap((page) =>
  groupPair(page.slug),
);

/** Every indexable content URL: games plus published group pages. */
export const INDEXABLE_SEO_ROUTES: readonly SeoRoute[] = [
  ...SEO_ROUTES,
  ...GROUP_SEO_ROUTES,
];

export function seoAbsoluteUrl(path: string): string {
  return `${SEO_PROD_ORIGIN}${path}`;
}

export function seoOgLocale(locale: Locale): string {
  return locale === "pt-BR" ? "pt_BR" : "en_US";
}

/** The route of `key` in `locale`. Every key has one route per locale. */
export function seoRoute(key: IndexableRouteKey, locale: Locale): SeoRoute {
  const route = INDEXABLE_SEO_ROUTES.find((r) => r.key === key && r.locale === locale);
  if (!route) throw new Error(`no SEO route for ${key} in ${locale}`);
  return route;
}

/**
 * File-safe name of a route, e.g. `pt-br-conexoes` or `en-quiz`. The same
 * names are used by web/public/llms/*.md.
 */
export function seoRouteSlug(route: SeoRoute): string {
  const segments = route.path.split("/").filter(Boolean);
  return segments.length > 1 ? segments.join("-") : `${segments[0]}-quiz`;
}

/**
 * Site-relative path of the OG image of a route. The quiz route is also the
 * home page, so its image is the generic site card; privacy and 404 reuse it.
 */
export function seoOgImagePath(key: IndexableRouteKey, locale: Locale): string {
  return `${SEO_OG_IMAGE_DIR}${seoRouteSlug(seoRoute(key, locale))}.png`;
}

export const SEO_OG_TAGLINE: Record<Locale, string> = {
  "pt-BR": "Jogos diários de K-pop com fontes",
  en: "Daily K-pop games with sources",
};

const GAME_NAME_FIELD = {
  quiz: "gameQuiz",
  grid: "gameGrid",
  connections: "gameConnections",
  nameGuess: "gameNameGuess",
  wordSearch: "gameWordSearch",
  mapPilot: "gameMap",
  timeline: "gameTimeline",
  code: "gameCode",
  crossword: "gameCrossword",
  strands: "gameStrands",
} as const satisfies Record<SeoRouteKey, keyof Messages>;

/** Name of the game as the navigation shows it. */
export function seoGameName(key: SeoRouteKey, messages: Messages): string {
  return messages[GAME_NAME_FIELD[key]];
}

/** Display name for OG cards and JSON-LD on any indexable route. */
export function seoRouteDisplayName(
  key: IndexableRouteKey,
  locale: Locale,
  messages: Messages,
  groupName?: string,
): string {
  if (isGroupPageKey(key)) {
    const name = groupName ?? key.slice("group:".length);
    return locale === "pt-BR" ? `Quiz de ${name}` : `${name} quiz`;
  }
  return seoGameName(key, messages);
}

/** Alt text of the OG image, describing what the card shows. */
export function seoOgImageAlt(
  key: IndexableRouteKey,
  locale: Locale,
  messages: Messages,
  groupName?: string,
): string {
  const host = new URL(SEO_PROD_ORIGIN).host;
  if (key === "quiz") return `K-pop Quiz. ${SEO_OG_TAGLINE[locale]}. ${host}`;
  if (isGroupPageKey(key)) {
    const name = seoRouteDisplayName(key, locale, messages, groupName);
    return locale === "pt-BR"
      ? `${name} no K-pop Quiz em ${host}`
      : `${name} on K-pop Quiz at ${host}`;
  }
  const name = seoGameName(key, messages);
  return locale === "pt-BR"
    ? `${name}, jogo diário do K-pop Quiz em ${host}`
    : `${name}, a daily K-pop Quiz game at ${host}`;
}

/** Short share tag of a game: the last segment of its English path. */
export function seoShareCampaign(key: SeoRouteKey): string {
  const segments = seoRoute(key, "en").path.split("/").filter(Boolean);
  return segments.length > 1 ? segments[segments.length - 1]! : "quiz";
}

/**
 * Production URL of a game in the player's language, tagged with `?s=<jogo>`
 * so analytics can count visits from shared results. Staging shares the same
 * URL: the link points people at the live game, never at the staging host.
 */
export function seoShareUrl(key: SeoRouteKey, locale: Locale): string {
  const params = new URLSearchParams({
    s: seoShareCampaign(key),
  });
  return `${seoAbsoluteUrl(seoRoute(key, locale).path)}?${params}`;
}

/** Standard GA4 campaign fields, applied only by the consent-gated config. */
export function shareCampaignConfig(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const campaign = params.get("s");
  if (["utm_source", "utm_medium", "utm_campaign"].some((key) => params.has(key))) return {};
  if (!campaign || !SEO_ROUTES.some((route) => seoShareCampaign(route.key) === campaign)) return {};
  return { campaign_source: "share", campaign_medium: "social", campaign_name: campaign };
}
