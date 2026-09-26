import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/**
 * Focuses `ref` when `active` turns true, and again whenever `step` changes
 * while it stays true. Use it for the action a player unlocks (Next,
 * Submit, Play again) so Enter works at once.
 *
 * Focus skips scrolling: the target lives in the sticky action bar, which is
 * already on screen, and a scroll there would move the board.
 */
export function useFocusOnChange<T extends HTMLElement>(
  ref: RefObject<T>,
  active: boolean,
  step?: string | number | undefined,
): void {
  useEffect(() => {
    if (active) ref.current?.focus({ preventScroll: true });
  }, [active, step]);
}
