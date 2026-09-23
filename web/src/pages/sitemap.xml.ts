import type { APIRoute } from "astro";
import { SEO_ROUTES, seoAbsoluteUrl } from "../lib/seo-routes";

export const GET: APIRoute = () => {
  // Sitemap always lists the 10 canonical production URLs, in any build.
  // Staging stays out of the index via robots `Disallow: /` + `noindex`.
  const urls = SEO_ROUTES.map(
    (route) => `  <url><loc>${seoAbsoluteUrl(route.path)}</loc></url>`,
  ).join("\n");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
