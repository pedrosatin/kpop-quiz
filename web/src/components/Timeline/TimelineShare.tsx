import { trackGameEvent } from "../../lib/game-analytics";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import type { TimelineShareMessages, TimelineShareProps } from "./types";
import { defaultTimelineMessages } from "./types";
import { shareTextToUser } from "../Results/share-text";
import { useResultActionGuard } from "../Results/use-result-action-guard";
export { RESULT_GUARD_MS } from "../Results/use-result-action-guard";

/** The share copy: each custom message, else the built-in one for `locale`. */
function shareCopy(locale: Locale, messages: Partial<TimelineShareMessages> | undefined): TimelineShareMessages {
  const defaults = defaultTimelineMessages(locale);
  return {
    share: messages?.share ?? defaults.share,
    copiedToClipboard: messages?.copiedToClipboard ?? defaults.copiedToClipboard,
    shareFailed: messages?.shareFailed ?? defaults.shareFailed,
    shareTextLabel: messages?.shareTextLabel ?? defaults.shareTextLabel,
  };
}

/** What the live region reads after the last share: the copy, the failure or nothing. */
function shareAnnouncement(copied: boolean, shareFailed: boolean, copy: TimelineShareMessages): string {
  if (copied) return copy.copiedToClipboard;
  if (shareFailed) return copy.shareFailed;
  return "";
}

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

  const copy = shareCopy(locale, messages);

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
      trackGameEvent("share", { game: "timeline", locale }, "native");
      onShareSuccess?.();
      return;
    }
    if (outcome === "copied") {
      trackGameEvent("share", { game: "timeline", locale }, "clipboard");
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
        {copy.share}
      </button>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="timeline-share-live"
      >
        <span key={announcementKey}>
          {shareAnnouncement(copied, shareFailed, copy)}
        </span>
      </div>

      {shareFailed && (
        <div class="timeline-share-fallback">
          <p id={shareFailedId} class="timeline-share-fallback-msg">
            {copy.shareFailed}
          </p>
          <textarea
            id={shareTextId}
            class="timeline-share-preview"
            readOnly
            rows={4}
            value={shareText}
            aria-label={copy.shareTextLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}
    </div>
  );
}
