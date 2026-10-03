import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { TimelineShareProps } from "./types";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";
import { shareTextToUser } from "../Results/share-text";
import { useResultActionGuard } from "../Results/use-result-action-guard";
export { RESULT_GUARD_MS } from "../Results/use-result-action-guard";

export function TimelineShare({
  shareText,
  locale = "pt-BR",
  messages,
  onShareSuccess,
  onShareError,
}: TimelineShareProps) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [announcementKey, setAnnouncementKey] = useState(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareTextId = useId();
  const shareFailedId = useId();
  const { guarded, ignoreRepeat } = useResultActionGuard();

  const defaultMsgs = DEFAULT_TIMELINE_MESSAGES[locale] || DEFAULT_TIMELINE_MESSAGES["pt-BR"];
  const shareLabel = messages?.share ?? defaultMsgs.share;
  const copiedMsg = messages?.copiedToClipboard ?? defaultMsgs.copiedToClipboard;
  const failedMsg = messages?.shareFailed ?? defaultMsgs.shareFailed;
  const previewLabel = messages?.shareTextLabel ?? defaultMsgs.shareTextLabel;

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  const handleShare = async () => {
    const outcome = await shareTextToUser(shareText);
    if (outcome === "aborted") return;
    if (outcome === "shared") {
      onShareSuccess?.();
      return;
    }
    if (outcome === "copied") {
      setShareFailed(false);
      setCopied(true);
      setAnnouncementKey((k) => k + 1);
      onShareSuccess?.();
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = setTimeout(() => {
        copiedTimer.current = null;
        setCopied(false);
      }, 3000);
      return;
    }
    setCopied(false);
    setShareFailed(true);
    setAnnouncementKey((k) => k + 1);
    onShareError?.();
  };

  return (
    <div class="timeline-share">
      <button
        type="button"
        class="btn btn-primary timeline-share-btn"
        onClick={guarded(() => { void handleShare(); })}
        onKeyDown={ignoreRepeat}
      >
        {shareLabel}
      </button>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="timeline-share-live"
      >
        <span key={announcementKey}>
          {copied ? copiedMsg : shareFailed ? failedMsg : ""}
        </span>
      </div>

      {shareFailed && (
        <div class="timeline-share-fallback">
          <p id={shareFailedId} class="timeline-share-fallback-msg">
            {failedMsg}
          </p>
          <textarea
            id={shareTextId}
            class="timeline-share-preview"
            readOnly
            rows={4}
            value={shareText}
            aria-label={previewLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}
    </div>
  );
}
