import { useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { peekQuizProgressSave } from "./storage";
import type { QuizSettings } from "./useQuizSettings";

/** Where the saved general quiz stopped, as the player counts questions. */
export type GeneralResume = { question: number; total: number };

function peekGeneralResume(locale: Locale, playMode: QuizSettings["playMode"]): GeneralResume | null {
  const save = peekQuizProgressSave({ locale, playMode, theme: "history", decades: [] });
  return save && save.machine_state !== "results"
    ? { question: save.question_index + 1, total: save.session.questions.length }
    : null;
}

/**
 * A visit that falls on today's challenge may leave a general quiz half
 * played in this language and mode. The general card then says where it
 * stopped, and picking it restores that round. The same note stays when the
 * finished daily opens the general setup without restoring (openSetup), so
 * the card still names the saved round. An explicit ?theme=daily keeps the
 * usual description. Only the unfiltered general quiz counts. Storage is read
 * after hydration, so the server HTML and the first client render agree.
 */
export function useGeneralResume(locale: Locale, settings: QuizSettings): GeneralResume | null {
  const [resume, setResume] = useState<GeneralResume | null>(null);
  const { playMode, theme, onDefaultTheme } = settings;
  useEffect(() => {
    const onGeneralSetup = theme === "history";
    const onDefaultDaily = onDefaultTheme && theme === "daily";
    if (!onGeneralSetup && !onDefaultDaily) {
      setResume(null);
      return;
    }
    setResume(peekGeneralResume(locale, playMode));
  }, [locale, playMode, theme, onDefaultTheme]);
  return resume;
}

/**
 * On the finished daily screen the URL already names the daily theme, so the
 * setup's onDefaultTheme gate does not apply. This still reports where the
 * general round stopped so the player can open the setup or continue it.
 */
export function useDailyDoneGeneralResume(locale: Locale, settings: QuizSettings): GeneralResume | null {
  const [resume, setResume] = useState<GeneralResume | null>(null);
  const { playMode, theme } = settings;
  useEffect(() => {
    if (theme !== "daily") {
      setResume(null);
      return;
    }
    setResume(peekGeneralResume(locale, playMode));
  }, [locale, playMode, theme]);
  return resume;
}
