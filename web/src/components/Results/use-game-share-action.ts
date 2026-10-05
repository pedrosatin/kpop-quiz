import { useEffect, useRef, useState } from "preact/hooks";
import { sharePayload } from "./share-text";

const COPIED_FEEDBACK_MS = 3000;

export interface UseGameShareActionOptions {
  onCopied?: (() => void) | undefined;
  onShareFailed?: (() => void) | undefined;
}

/**
 * Share sheet, then clipboard, then a select-and-copy field. Copied feedback
 * clears after a few seconds; AbortError is not treated as failure.
 *
 * The share/clipboard awaits stay in this function (not a nested async
 * helper) so Testing Library's act still flushes the parent live-region
 * update in the same turn as the existing game tests expect.
 */
export function useGameShareAction({ onCopied, onShareFailed }: UseGameShareActionOptions = {}) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopiedRef = useRef(onCopied);
  const onShareFailedRef = useRef(onShareFailed);
  onCopiedRef.current = onCopied;
  onShareFailedRef.current = onShareFailed;

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const handleShare = async (text: string) => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (typeof nav?.share === "function") {
      try {
        await nav.share(sharePayload(text));
        return;
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      }
    }
    try {
      if (typeof nav?.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await nav.clipboard.writeText(text);
    } catch {
      setShareFailed(true);
      onShareFailedRef.current?.();
      return;
    }
    setShareFailed(false);
    setCopied(true);
    onCopiedRef.current?.();
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  };

  return { copied, shareFailed, handleShare };
}
