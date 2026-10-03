import { describe, expect, it } from "vitest";
import { joinBaseUrl } from "./join-base-url";

describe("joinBaseUrl", () => {
  it("preserves a GitHub Pages subdirectory prefix", () => {
    expect(
      joinBaseUrl("https://pedrosatin.github.io/kpop-quiz/", "/pt-br/"),
    ).toBe("https://pedrosatin.github.io/kpop-quiz/pt-br/");
    expect(
      joinBaseUrl("https://pedrosatin.github.io/kpop-quiz", "/pt-br/grid/"),
    ).toBe("https://pedrosatin.github.io/kpop-quiz/pt-br/grid/");
  });

  it("joins against a root production origin", () => {
    expect(joinBaseUrl("https://kpopquiz.online", "/pt-br/")).toBe(
      "https://kpopquiz.online/pt-br/",
    );
    expect(joinBaseUrl("https://kpopquiz.online/", "/en/")).toBe(
      "https://kpopquiz.online/en/",
    );
  });

  it("joins against the local preview origin", () => {
    expect(joinBaseUrl("http://127.0.0.1:4321", "/pt-br/")).toBe(
      "http://127.0.0.1:4321/pt-br/",
    );
    expect(joinBaseUrl("http://127.0.0.1:4321/", "/pt-br/privacidade/")).toBe(
      "http://127.0.0.1:4321/pt-br/privacidade/",
    );
  });
});
