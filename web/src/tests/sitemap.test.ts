import { afterEach, describe, expect, it, vi } from "vitest";
import { SEO_ROUTES, seoAbsoluteUrl } from "../lib/seo-routes";
import { GET } from "../pages/sitemap.xml";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("sitemap.xml", () => {
  it.each(["/", "/kpop-quiz/"])(
    "omits lastmod regardless of the clock with BASE_URL %s",
    async (baseUrl) => {
      vi.stubEnv("BASE_URL", baseUrl);
      vi.useFakeTimers({ toFake: ["Date"] });
      const bodies: string[] = [];
      for (const date of ["2026-10-23T12:00:00Z", "2027-02-01T12:00:00Z"]) {
        vi.setSystemTime(new Date(date));
        const response = await GET({} as Parameters<typeof GET>[0]);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
        const body = await response.text();
        expect(body).not.toMatch(/<lastmod\b/);
        bodies.push(body);
      }
      expect(bodies[0]).toBe(bodies[1]);
    },
  );

  it("serves all 18 canonical URLs with their language pair and English x-default", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    expect(xml.querySelector("parsererror")).toBeNull();
    const urls = [...xml.getElementsByTagName("url")];
    expect(urls).toHaveLength(18);
    expect(urls.map((url) => url.querySelector("loc")?.textContent)).toEqual(
      SEO_ROUTES.map((route) => seoAbsoluteUrl(route.path)),
    );
    for (const [index, url] of urls.entries()) {
      const route = SEO_ROUTES[index]!;
      const alternate = SEO_ROUTES.find((entry) => entry.path === route.alternatePath)!;
      const english = route.locale === "en" ? route : alternate;
      const links = [...url.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link")];
      expect(links).toHaveLength(3);
      expect(links.map((link) => ({
        rel: link.getAttribute("rel"),
        hreflang: link.getAttribute("hreflang"),
        href: link.getAttribute("href"),
      }))).toEqual(expect.arrayContaining([
        { rel: "alternate", hreflang: route.locale, href: seoAbsoluteUrl(route.path) },
        { rel: "alternate", hreflang: alternate.locale, href: seoAbsoluteUrl(alternate.path) },
        { rel: "alternate", hreflang: "x-default", href: seoAbsoluteUrl(english.path) },
      ]));
    }
  });
});
