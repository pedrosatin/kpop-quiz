import { trackGameEvent, type GameAnalyticsContext } from "../../lib/game-analytics";
import { useEffect, useRef, useState } from "preact/hooks";
import { shareTextToUser } from "./share-text";

/** How long the "copied" feedback stays visible after a clipboard share. */
export const COPIED_FEEDBACK_MS = 3000;

export interface UseGameShareActionOptions {
  analytics?: GameAnalyticsContext;
  onCopied?: (() => void) | undefined;
  onShareFailed?: (() => void) | undefined;
}

/**
 * Orchestrates feedback, analytics and anti-reentry on top of
 * `shareTextToUser`. Copied feedback clears after `COPIED_FEEDBACK_MS`;
 * AbortError is not treated as failure.
 */
export function useGameShareAction({ onCopied, onShareFailed, analytics }: UseGameShareActionOptions = {}) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const sharing = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopiedRef = useRef(onCopied);
  const onShareFailedRef = useRef(onShareFailed);
  onCopiedRef.current = onCopied;
  onShareFailedRef.current = onShareFailed;

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const handleShare = async (text: string) => {
    if (sharing.current) return;
    sharing.current = true;
    try {
      const outcome = await shareTextToUser(text);
      if (outcome === "aborted") return;
      if (outcome === "shared") {
        if (analytics) trackGameEvent("share", analytics, "native");
        return;
      }
      if (outcome === "copied") {
        if (analytics) trackGameEvent("share", analytics, "clipboard");
        setShareFailed(false);
        setCopied(true);
        onCopiedRef.current?.();
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => {
          copiedTimer.current = null;
          setCopied(false);
        }, COPIED_FEEDBACK_MS);
        return;
      }
      setShareFailed(true);
      onShareFailedRef.current?.();
    } finally {
      sharing.current = false;
    }
  };

  return { copied, shareFailed, handleShare };
}
