import type { APIRoute } from "astro";
import { INDEXABLE_SEO_ROUTES } from "../lib/seo-routes";
import { buildSitemapXml } from "../lib/sitemap";

export const GET: APIRoute = () => {
  return new Response(buildSitemapXml(INDEXABLE_SEO_ROUTES), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
