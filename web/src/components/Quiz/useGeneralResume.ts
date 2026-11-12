import { useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { peekQuizProgressSave } from "./storage";
import type { QuizSettings } from "./useQuizSettings";

/** Where the saved general quiz stopped, as the player counts questions. */
export type GeneralResume = { question: number; total: number };

/**
 * A visit that falls on today's challenge may leave a general quiz half
 * played in this language and mode. The general card then says where it
 * stopped, and picking it restores that round. Only the unfiltered general
 * quiz counts, and only until the player picks a kind of quiz. Storage is read
 * after hydration, so the server HTML and the first client render agree.
 */
export function useGeneralResume(locale: Locale, settings: QuizSettings): GeneralResume | null {
  const [resume, setResume] = useState<GeneralResume | null>(null);
  const { playMode, theme, onDefaultTheme } = settings;
  useEffect(() => {
    if (!onDefaultTheme || theme !== "daily") {
      setResume(null);
      return;
    }
    const save = peekQuizProgressSave({ locale, playMode, theme: "history", decades: [] });
    setResume(save && save.machine_state !== "results"
      ? { question: save.question_index + 1, total: save.session.questions.length }
      : null);
  }, [locale, playMode, theme, onDefaultTheme]);
  return resume;
}
