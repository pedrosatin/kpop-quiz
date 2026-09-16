import type { PlayMode } from "../../lib/quiz-types";
import { loadStoredPreferences } from "./storage";

export function getInitialUrlParams(): { playMode: PlayMode; theme: string } {
  let playMode: PlayMode = loadStoredPreferences().playMode ?? "standard";
  let theme = "history";
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");
    if (modeParam === "assisted" || modeParam === "standard" || modeParam === "expert") {
      playMode = modeParam;
    }
    const themeParam = params.get("theme");
    if (themeParam) {
      theme = themeParam;
    }
  }
  return { playMode, theme };
}

export function updateUrlParams(mode: PlayMode, theme: string): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    url.searchParams.set("theme", theme);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    const langLink = document.querySelector<HTMLAnchorElement>(".language-link");
    if (langLink) {
      const u = new URL(langLink.href, window.location.origin);
      u.search = url.searchParams.toString();
      langLink.href = u.pathname + (u.search ? "?" + u.search : "") + u.hash;
    }
  } catch {
    // URL or replaceState may fail in constrained environments
  }
}
