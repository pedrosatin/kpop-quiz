import type { APIRoute } from "astro";
import { SEO_PROD_ORIGIN } from "../lib/seo-routes";

export const GET: APIRoute = () => {
  // Same flag as BaseLayout: prefixed BASE_URL builds are staging,
  // so keep crawlers out entirely.
  const isStaging = import.meta.env.BASE_URL.replace(/\/$/, "") !== "";
  // Production leaves /data/ crawlable: Google renders the game islands with
  // the daily JSON, and the X-Robots-Tag: noindex in public/_headers only
  // reaches a crawler that is allowed to fetch the file (ADR 022).
  const body = isStaging
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\nSitemap: ${SEO_PROD_ORIGIN}/sitemap.xml\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
