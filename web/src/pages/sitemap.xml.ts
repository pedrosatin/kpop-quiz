import type { APIRoute } from "astro";
import { INDEXABLE_SEO_ROUTES } from "../lib/seo-routes";
import { buildSitemapXml } from "../lib/sitemap";

export const GET: APIRoute = () => {
  // Sitemap lists every indexable production URL (games + group pages).
  // Staging stays out of the index via robots `Disallow: /` + `noindex`.
  return new Response(buildSitemapXml(INDEXABLE_SEO_ROUTES), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
