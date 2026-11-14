import { useEffect, useRef } from "preact/hooks";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import type { QuizMatch } from "./useQuizMatch";

/** Moves focus as the round advances; a restored visit keeps the page's focus. */
export function useQuizFocus({ state, questionIndex, restoredVisit, focusQuestionRef, focusRestoredRef, focusSetupRef }: QuizMatch) {
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);

  useFocusOnChange(nextButtonRef, state === "question.answered" && !restoredVisit, questionIndex);
  useFocusOnChange(resultHeadingRef, state === "results" && !restoredVisit);

  useEffect(() => {
    if (focusQuestionRef.current && (state === "question.ready" || state === "setup")) {
      headingRef.current?.focus();
      focusQuestionRef.current = false;
    }
  }, [questionIndex, state]);

  // A round the player chose to continue replaces the control they used, so
  // its question takes the focus instead of the page.
  // "Jogar o Quiz geral" unmounts with the result it sits on. The general
  // quiz then opens either a saved round, whose question takes the focus
  // above, or its setup, whose title takes it here.
  useEffect(() => {
    if (focusRestoredRef.current && (state === "question.ready" || state === "question.answered")) {
      headingRef.current?.focus();
      focusRestoredRef.current = false;
      focusSetupRef.current = false;
    } else if (focusSetupRef.current && state === "setup") {
      setupHeadingRef.current?.focus();
      focusSetupRef.current = false;
      focusRestoredRef.current = false;
    }
  }, [state]);

  return { nextButtonRef, headingRef, resultHeadingRef, setupHeadingRef };
}

export type QuizFocusRefs = ReturnType<typeof useQuizFocus>;
