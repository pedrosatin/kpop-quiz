import type { APIRoute } from "astro";
import { SEO_PROD_ORIGIN } from "../lib/seo-routes";

export const GET: APIRoute = () => {
  const isStaging = import.meta.env.BASE_URL.replace(/\/$/, "") !== "";
  const body = isStaging
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nDisallow: /data/next/\nAllow: /\nSitemap: ${SEO_PROD_ORIGIN}/sitemap.xml\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
