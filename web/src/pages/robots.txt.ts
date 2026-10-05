import type { APIRoute } from "astro";
import { SEO_PROD_ORIGIN } from "../lib/seo-routes";

export const GET: APIRoute = () => {
  // Same flag as BaseLayout: prefixed BASE_URL builds are staging,
  // so keep crawlers out entirely.
  const isStaging = import.meta.env.BASE_URL.replace(/\/$/, "") !== "";
  // Production leaves /data/ crawlable: Google renders the game islands with
  // the daily JSON, and the X-Robots-Tag: noindex in public/_headers only
  // reaches a crawler that is allowed to fetch the file (ADR 022). The one
  // exception is /data/next/, the next day's puzzles: the daily workflow
  // publishes them there between 12:00 and 24:00 in Sao Paulo, and they are
  // answers to a game that has not started yet. The islands fall back to the
  // main artifact when the next/ fetch fails (daily-artifact.ts), so the
  // block never breaks a route.
  const body = isStaging
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nDisallow: /data/next/\nAllow: /\nSitemap: ${SEO_PROD_ORIGIN}/sitemap.xml\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
