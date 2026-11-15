import { useLayoutEffect, type MutableRef } from "preact/hooks";
import type { CodeGroupsFeedback } from "./code-groups-state";

const EDGE_GAP = 12;

/**
 * After a guess or a rejection sent in this visit, scrolls so the player
 * sees its outcome: the result when the round ended, otherwise the feedback
 * line, kept clear of the screen edges and of the consent banner.
 */
export function useCodeGroupsFeedbackScroll(
  feedback: CodeGroupsFeedback,
  finished: boolean,
  playedHere: MutableRef<boolean>,
  resultRef: MutableRef<HTMLElement | null>,
  feedbackRef: MutableRef<HTMLParagraphElement | null>,
): void {
  useLayoutEffect(() => {
    if (!feedback || !playedHere.current) return;
    if (finished) {
      resultRef.current?.scrollIntoView?.({ block: "start" });
      return;
    }
    const target = feedbackRef.current;
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const bannerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--consent-banner-height")) || 0;
    const visibleBottom = window.innerHeight - bannerHeight - EDGE_GAP;
    if (bounds.bottom > visibleBottom) window.scrollBy(0, bounds.bottom - visibleBottom);
    else if (bounds.top < EDGE_GAP) window.scrollBy(0, bounds.top - EDGE_GAP);
  }, [feedback, finished]);
}
