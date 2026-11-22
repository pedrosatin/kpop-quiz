import { useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { seoRoute } from "../../lib/seo-routes";
import { checkOtherLocaleSaveCompatibility, findOtherLocaleRound } from "./saved-rounds";
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
  /**
   * False when the save no longer matches the live artifact: the setup explains
   * that the round cannot continue and omits the "Continuar" link.
   */
  resumable: boolean;
};

/** Quiz page of the save's language, with the URL params that select its slot. */
export function otherLocaleRoundHref(save: QuizProgressSave, base: string = import.meta.env.BASE_URL): string {
  const params = new URLSearchParams({ mode: save.play_mode, theme: save.decades.length ? "history" : save.theme });
  [...save.decades].sort().forEach((decade) => params.append("decade", String(decade)));
  return `${base.replace(/\/$/, "")}${seoRoute("quiz", save.locale).path}?${params.toString()}`;
}

function toRound(save: QuizProgressSave, resumable: boolean): OtherLocaleRound {
  return {
    locale: save.locale,
    theme: save.theme,
    question: Math.min(save.question_index, save.session.questions.length - 1) + 1,
    total: save.session.questions.length,
    href: otherLocaleRoundHref(save),
    resumable,
  };
}

/**
 * Slots are kept per language, so switching language mid-round opens a clean
 * page while the round stays saved in the other one. This finds that round
 * and checks it against the live artifact before offering a resume link.
 * Storage is read after hydration, so the server HTML and the first client
 * render agree, and nothing is deleted.
 */
export function useOtherLocaleRound(locale: Locale): OtherLocaleRound | null {
  const [round, setRound] = useState<OtherLocaleRound | null>(null);
  useEffect(() => {
    let cancelled = false;
    const save = findOtherLocaleRound(locale);
    if (!save) {
      setRound(null);
      return;
    }
    setRound(null);
    void checkOtherLocaleSaveCompatibility(save).then((compat) => {
      if (cancelled) return;
      setRound(toRound(save, compat === "ok"));
    }).catch(() => {
      if (cancelled) return;
      setRound(toRound(save, false));
    });
    return () => { cancelled = true; };
  }, [locale]);
  return round;
}
