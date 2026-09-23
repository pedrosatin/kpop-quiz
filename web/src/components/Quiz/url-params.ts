import type { PlayMode } from "../../lib/quiz-types";
import { loadStoredPreferences } from "./storage";

export type QuizTheme = "history" | "daily";
export type QuizDecadeValue = 1990 | 2000 | 2010 | 2020;
export type QuizDecade = QuizDecadeValue | null;
export type QuizDecadeSelection = QuizDecadeValue[];

const isQuizDecade = (value: number): value is QuizDecadeValue =>
  [1990, 2000, 2010, 2020].includes(value);

export function getInitialUrlParams(): { playMode: PlayMode; theme: QuizTheme; decades: QuizDecadeSelection } {
  let playMode: PlayMode = loadStoredPreferences().playMode ?? "standard";
  let theme: QuizTheme = "history";
  let decades: QuizDecadeSelection = [];
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
    decades = [...new Set(params.getAll("decade").map(Number).filter(isQuizDecade))].sort();
    if (decades.length) theme = "history";
  }
  return { playMode, theme, decades };
}

export function updateUrlParams(
  mode: PlayMode,
  theme: QuizTheme,
  decades: readonly QuizDecadeValue[] = [],
): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    const selectedDecades = [...new Set(decades.filter(isQuizDecade))].sort();
    url.searchParams.set("theme", selectedDecades.length ? "history" : theme);
    url.searchParams.delete("decade");
    selectedDecades.forEach((decade) => url.searchParams.append("decade", String(decade)));
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
