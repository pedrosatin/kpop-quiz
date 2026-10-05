import { describe, expect, it } from "vitest";
import { GET } from "../pages/robots.txt";

describe("robots.txt", () => {
  it("lets crawlers fetch /data/ in production so Google can render the games", async () => {
    // Vitest runs with BASE_URL "/", the production build.
    const response = await GET({} as Parameters<typeof GET>[0]);
    const body = await response.text();
    expect(body).toContain("Allow: /");
    expect(body).not.toMatch(/^Disallow:/m);
    expect(body).toContain("Sitemap: https://kpopquiz.online/sitemap.xml");
  });
});
