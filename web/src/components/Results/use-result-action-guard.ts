import { useLayoutEffect, useRef } from "preact/hooks";

/** How long result buttons ignore activation after they replace in-game controls. */
export const RESULT_GUARD_MS = 300;

/**
 * Result panels replace sticky controls. A second tap or held Enter meant for
 * the previous control must not share or restart.
 */
export function useResultActionGuard(guardMs = RESULT_GUARD_MS) {
  const shownAt = useRef(0);

  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, []);

  const guarded = (action: () => void) => () => {
    if (performance.now() - shownAt.current >= guardMs) action();
  };

  const ignoreRepeat = (event: KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  return { guarded, ignoreRepeat };
}
