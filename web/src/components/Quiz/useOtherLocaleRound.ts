import { useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { seoRoute } from "../../lib/seo-routes";
import { findOtherLocaleRound } from "./saved-rounds";
import type { QuizProgressSave } from "./storage";
import type { QuizTheme } from "./url-params";

/** A round saved in progress in the other language, and the link that resumes it there. */
export type OtherLocaleRound = {
  locale: Locale;
  theme: QuizTheme;
  /** Question the round stopped at, as the player counts. */
  question: number;
  total: number;
  href: string;
};

/** Quiz page of the save's language, with the URL params that select its slot. */
export function otherLocaleRoundHref(save: QuizProgressSave, base: string = import.meta.env.BASE_URL): string {
  const params = new URLSearchParams({ mode: save.play_mode, theme: save.decades.length ? "history" : save.theme });
  [...save.decades].sort().forEach((decade) => params.append("decade", String(decade)));
  return `${base.replace(/\/$/, "")}${seoRoute("quiz", save.locale).path}?${params.toString()}`;
}

/**
 * Slots are kept per language, so switching language mid-round opens a clean
 * page while the round stays saved in the other one. This finds that round
 * so the setup can say where it is. Storage is read after hydration, so the
 * server HTML and the first client render agree, and nothing is deleted.
 */
export function useOtherLocaleRound(locale: Locale): OtherLocaleRound | null {
  const [round, setRound] = useState<OtherLocaleRound | null>(null);
  useEffect(() => {
    const save = findOtherLocaleRound(locale);
    setRound(save
      ? {
        locale: save.locale,
        theme: save.theme,
        question: Math.min(save.question_index, save.session.questions.length - 1) + 1,
        total: save.session.questions.length,
        href: otherLocaleRoundHref(save),
      }
      : null);
  }, [locale]);
  return round;
}
