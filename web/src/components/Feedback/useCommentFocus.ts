import { useEffect, useRef } from "preact/hooks";

/**
 * Once the vote is confirmed, focus moves to the comment if nothing is focused.
 * Removing the vote buttons leaves focus on body. Any external control
 * keeps focus, including one active before a programmatic vote.
 */
export function useCommentFocus(voteId: string, pending: boolean) {
  const commentInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (voteId && !pending && document.activeElement === document.body) {
      commentInput.current?.focus();
    }
  }, [voteId, pending]);
  return { commentInput };
}
