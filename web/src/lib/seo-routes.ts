import type { Locale } from "./quiz-types";
import type { SeoRouteKey } from "../i18n/catalog";

export const SEO_PROD_ORIGIN = "https://kpopquiz.online";
export const SEO_OG_IMAGE_PATH = "/apple-touch-icon.png";
export const SEO_DEFAULT_PATH = "/pt-br/";

export interface SeoRoute {
  key: SeoRouteKey;
  locale: Locale;
  path: string;
  alternatePath: string;
}

function pair(
  key: SeoRouteKey,
  ptPath: string,
  enPath: string,
): [SeoRoute, SeoRoute] {
  return [
    { key, locale: "pt-BR", path: ptPath, alternatePath: enPath },
    { key, locale: "en", path: enPath, alternatePath: ptPath },
  ];
}

// Exactly the 12 indexable content routes. The `/` canonical alias, `/data/*`,
// staging builds and `?mode`/`?theme` variants stay out of the index.
export const SEO_ROUTES: readonly SeoRoute[] = [
  ...pair("quiz", "/pt-br/", "/en/"),
  ...pair("grid", "/pt-br/grid/", "/en/grid/"),
  ...pair("connections", "/pt-br/conexoes/", "/en/connections/"),
  ...pair("nameGuess", "/pt-br/adivinhe/", "/en/guess/"),
  ...pair("wordSearch", "/pt-br/caca-palavras/", "/en/word-search/"),
  ...pair("mapPilot", "/pt-br/mapa/", "/en/map/"),
];

export function seoAbsoluteUrl(path: string): string {
  return `${SEO_PROD_ORIGIN}${path}`;
}

export function seoOgLocale(locale: Locale): string {
  return locale === "pt-BR" ? "pt_BR" : "en_US";
}
