import { useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { useGameShareAction } from "../Results/use-game-share-action";

/** The outcome of one Share press; `n` counts the presses. */
export type CodeGroupsShareFeedback = { kind: "copied" | "shareFailed"; n: number };

/**
 * The Share action of the result and the outcome of the last press. A new
 * `n` replaces the live-region paragraph, so the same message is announced
 * again.
 */
export function useCodeGroupsShare(locale: Locale) {
  const shares = useRef(0);
  const [shareFeedback, setShareFeedback] = useState<CodeGroupsShareFeedback | null>(null);
  const { copied, shareFailed, handleShare } = useGameShareAction({
    analytics: { game: "code", locale, daily: "yes" },
    onCopied: () => setShareFeedback({ kind: "copied", n: ++shares.current }),
    onShareFailed: () => setShareFeedback({ kind: "shareFailed", n: ++shares.current }),
  });
  return { copied, shareFailed, handleShare, shareFeedback };
}
