import { useCallback, useRef, useState } from "preact/hooks";
import type { Messages } from "../../i18n/catalog";

/** The last share and its count; n changes on every share, so the same message is announced again. */
export interface ShareNote {
  kind: "copied" | "shareFailed";
  n: number;
}

export function useShareNote() {
  const [shareNote, setShareNote] = useState<ShareNote | null>(null);
  const shares = useRef(0);
  const onCopied = useCallback(() => setShareNote({ kind: "copied", n: ++shares.current }), []);
  const onShareFailed = useCallback(() => setShareNote({ kind: "shareFailed", n: ++shares.current }), []);
  return { shareNote, onCopied, onShareFailed };
}

/**
 * What the live region says once the round is over: only the last copy or
 * its failure. A new key replaces the paragraph, so a second copy is
 * announced again.
 */
export function WordSearchShareNote({ note, messages }: { note: ShareNote | null; messages: Messages }) {
  if (note?.kind === "copied") return <p key={note.n}>{messages.copiedToClipboard}</p>;
  if (note?.kind === "shareFailed") return <p key={note.n}>{messages.shareFailed}</p>;
  return null;
}
