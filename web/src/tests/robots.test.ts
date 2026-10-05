import { describe, expect, it } from "vitest";
import { GET } from "../pages/robots.txt";

describe("robots.txt", () => {
  it("keeps tomorrow's answers (/data/next/) out and the rest of /data/ crawlable", async () => {
    // Vitest runs with BASE_URL "/", the production build.
    const response = await GET({} as Parameters<typeof GET>[0]);
    const body = await response.text();
    const disallows = body.split("\n").filter((line) => line.startsWith("Disallow:"));
    expect(disallows).toEqual(["Disallow: /data/next/"]);
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://kpopquiz.online/sitemap.xml");
  });
});
