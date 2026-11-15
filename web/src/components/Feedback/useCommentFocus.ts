import { useEffect, useRef } from "preact/hooks";

/**
 * Once the vote is confirmed, focus moves to the comment if it is still on
 * the control the player voted with, or on nothing. A player who moved
 * elsewhere while the vote was pending keeps their place.
 */
export function useCommentFocus(voteId: string, pending: boolean) {
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const voteControl = useRef<Element | null>(null);
  useEffect(() => {
    if (voteId && !pending && (document.activeElement === document.body || document.activeElement === voteControl.current)) {
      commentInput.current?.focus();
    }
  }, [voteId, pending]);
  return { commentInput, voteControl };
}
