import { useEffect, useRef } from "preact/hooks";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import type { QuizMatch } from "./useQuizMatch";

/** Moves focus as the round advances; a restored visit keeps the page's focus. */
export function useQuizFocus({ state, questionIndex, restoredVisit, focusQuestionRef }: QuizMatch) {
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useFocusOnChange(nextButtonRef, state === "question.answered" && !restoredVisit, questionIndex);
  useFocusOnChange(resultHeadingRef, state === "results" && !restoredVisit);

  useEffect(() => {
    if (focusQuestionRef.current && (state === "question.ready" || state === "setup")) {
      headingRef.current?.focus();
      focusQuestionRef.current = false;
    }
  }, [questionIndex, state]);

  return { nextButtonRef, headingRef, resultHeadingRef };
}

export type QuizFocusRefs = ReturnType<typeof useQuizFocus>;
