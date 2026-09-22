import type { PlayMode } from "../../lib/quiz-types";
import { loadStoredPreferences } from "./storage";

export type QuizTheme = "history" | "daily";
export type QuizDecade = 1990 | 2000 | 2010 | 2020 | null;

export function getInitialUrlParams(): { playMode: PlayMode; theme: QuizTheme; decade: QuizDecade } {
  let playMode: PlayMode = loadStoredPreferences().playMode ?? "standard";
  let theme: QuizTheme = "history";
  let decade: QuizDecade = null;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");
    if (modeParam === "assisted" || modeParam === "standard" || modeParam === "expert") {
      playMode = modeParam;
    }
    const themeParam = params.get("theme");
    if (themeParam === "history" || themeParam === "daily") {
      theme = themeParam;
    }
    const decadeParam = Number(params.get("decade"));
    if ([1990, 2000, 2010, 2020].includes(decadeParam)) decade = decadeParam as QuizDecade;
  }
  return { playMode, theme, decade };
}

export function updateUrlParams(mode: PlayMode, theme: QuizTheme, decade: QuizDecade = null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    url.searchParams.set("theme", theme);
    if (decade === null) url.searchParams.delete("decade");
    else url.searchParams.set("decade", String(decade));
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    const langLink = document.querySelector<HTMLAnchorElement>(".language-link");
    if (langLink) {
      const u = new URL(langLink.href, window.location.origin);
      u.search = url.searchParams.toString();
      langLink.href = u.pathname + u.search + u.hash;
    }
  } catch {
    // URL or replaceState may fail in constrained environments
  }
}
