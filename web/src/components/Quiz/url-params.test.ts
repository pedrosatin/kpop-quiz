import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInitialUrlParams, updateUrlParams } from "./url-params";

describe("url-params", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.querySelectorAll(".language-link").forEach((el) => el.remove());
  });

  describe("getInitialUrlParams", () => {
    it("extracts valid mode and theme query parameters from URL", () => {
      window.history.replaceState(null, "", "/?mode=expert&theme=daily");
      expect(getInitialUrlParams()).toEqual({
        playMode: "expert",
        theme: "daily",
        decade: null,
      });
    });

    it("extracts other valid mode and theme options", () => {
      window.history.replaceState(null, "", "/?mode=assisted&theme=history");
      expect(getInitialUrlParams()).toEqual({
        playMode: "assisted",
        theme: "history",
        decade: null,
      });
    });

    it("keeps a decade and drops daily when both are present", () => {
      window.history.replaceState(null, "", "/?theme=daily&decade=2010");
      expect(getInitialUrlParams()).toEqual({
        playMode: "standard",
        theme: "history",
        decade: 2010,
      });
    });

    it("rejects invalid values returning defaults (mode: standard, theme: history)", () => {
      window.history.replaceState(null, "", "/?mode=invalido&theme=desconhecido");
      expect(getInitialUrlParams()).toEqual({
        playMode: "standard",
        theme: "history",
        decade: null,
      });
    });

    it("uses stored preference for mode when mode param is missing or invalid", () => {
      window.localStorage.setItem("kpop-quiz-play-mode", "expert");
      window.history.replaceState(null, "", "/?theme=daily");
      expect(getInitialUrlParams()).toEqual({
        playMode: "expert",
        theme: "daily",
        decade: null,
      });
    });

    it("handles environment safely when window is undefined", () => {
      vi.stubGlobal("window", undefined);
      expect(getInitialUrlParams()).toEqual({
        playMode: "standard",
        theme: "history",
        decade: null,
      });
    });
  });

  describe("updateUrlParams", () => {
    it("updates window.location and .language-link href with a single '?' prefix", () => {
      window.history.replaceState(null, "", "/quiz");
      const replaceStateSpy = vi.spyOn(window.history, "replaceState");

      const langLink = document.createElement("a");
      langLink.className = "language-link";
      langLink.href = "/en/";
      document.body.appendChild(langLink);

      updateUrlParams("expert", "daily");

      expect(replaceStateSpy).toHaveBeenCalledWith(
        null,
        "",
        "/quiz?mode=expert&theme=daily"
      );

      expect(langLink.href).not.toContain("??");
      const url = new URL(langLink.href, window.location.origin);
      expect(url.search).toBe("?mode=expert&theme=daily");
      expect(url.pathname).toBe("/en/");
    });

    it("preserves existing hash when updating .language-link href", () => {
      const langLink = document.createElement("a");
      langLink.className = "language-link";
      langLink.href = "/en/#top";
      document.body.appendChild(langLink);

      updateUrlParams("standard", "history");

      expect(langLink.href).not.toContain("??");
      const url = new URL(langLink.href, window.location.origin);
      expect(url.search).toBe("?mode=standard&theme=history");
      expect(url.hash).toBe("#top");
    });

    it("runs safely when .language-link element does not exist in DOM", () => {
      window.history.replaceState(null, "", "/");
      expect(() => updateUrlParams("assisted", "daily")).not.toThrow();
    });

    it("runs safely when window is undefined", () => {
      vi.stubGlobal("window", undefined);
      expect(() => updateUrlParams("expert", "daily")).not.toThrow();
    });
  });
});
