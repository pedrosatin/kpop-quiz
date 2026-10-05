import type { APIRoute } from "astro";
import { SEO_ROUTES } from "../lib/seo-routes";
import { buildSitemapXml } from "../lib/sitemap";

export const GET: APIRoute = () => {
  // Sitemap always lists the 14 canonical production URLs, in any build.
  // Staging stays out of the index via robots `Disallow: /` + `noindex`.
  return new Response(buildSitemapXml(SEO_ROUTES, new Date()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
