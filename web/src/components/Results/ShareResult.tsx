import { useEffect, useRef, useState } from "preact/hooks";
import type { PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export interface GenerateShareTextParams {
  correctCount: number;
  totalQuestions: number;
  results: boolean[];
  playMode: PlayMode;
  cluesUsedCount: number;
  elapsedSeconds: number;
  messages: Messages;
  dailyDate?: string | null | undefined;
}

export function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatSquares(results: boolean[]): string {
  if (results.length === 0) return "";
  const blocks: string[] = [];
  for (let i = 0; i < results.length; i += 5) {
    blocks.push(
      results
        .slice(i, i + 5)
        .map((r) => (r ? "■" : "□"))
        .join("")
    );
  }
  return blocks.join(" ");
}

export function generateShareText({
  correctCount,
  totalQuestions,
  results,
  playMode,
  cluesUsedCount,
  elapsedSeconds,
  messages,
  dailyDate,
}: GenerateShareTextParams): string {
  const header = dailyDate
    ? messages.shareDailyHeader(dailyDate, correctCount, totalQuestions)
    : `K-pop Quiz ${correctCount}/${totalQuestions}`;
  const squares = formatSquares(results);
  const details = `${messages.difficultyName(playMode)} · ${messages.shareHints(cluesUsedCount)} · ${formatDuration(elapsedSeconds)}`;
  return `${header}\n${squares}\n${details}`;
}

export interface ShareResultProps {
  correctCount: number;
  totalQuestions: number;
  results: boolean[];
  playMode: PlayMode;
  cluesUsedCount: number;
  elapsedSeconds: number;
  messages: Messages;
  dailyDate?: string | null | undefined;
}

export function ShareResult({
  correctCount,
  totalQuestions,
  results,
  playMode,
  cluesUsedCount,
  elapsedSeconds,
  messages,
  dailyDate,
}: ShareResultProps) {
  const [canShare, setCanShare] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hasShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    const hasCopy = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
    setCanShare(hasShare);
    setCanCopy(hasCopy);
    if (!hasShare && !hasCopy) {
      setShowFallback(true);
    }

    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const shareText = generateShareText({
    correctCount,
    totalQuestions,
    results,
    playMode,
    cluesUsedCount,
    elapsedSeconds,
    messages,
    dailyDate,
  });

  const handleAction = async () => {
    if (canShare) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
      }
    }
    if (canCopy) {
      try {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        if (copyTimeoutRef.current !== null) {
          clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          copyTimeoutRef.current = null;
        }, 4000);
        return;
      } catch {
        setShowFallback(true);
      }
    } else {
      setShowFallback(true);
    }
  };

  return (
    <div class="share-result">
      {(!showFallback || canShare || canCopy) && (
        <button
          type="button"
          class="secondary-action share-button"
          onClick={handleAction}
        >
          {canShare ? messages.share : messages.copyResult}
        </button>
      )}
      {copied && (
        <p role="status" aria-live="polite" class="share-feedback">
          {messages.copiedToClipboard}
        </p>
      )}
      {showFallback && (
        <div class="share-fallback">
          <label htmlFor="share-text-area" class="share-fallback-label">
            {messages.shareTextLabel}
          </label>
          <textarea
            id="share-text-area"
            class="share-textarea"
            readOnly
            value={shareText}
            rows={3}
            aria-label={messages.shareTextLabel}
            onClick={(event) => (event.target as HTMLTextAreaElement).select()}
            onFocus={(event) => (event.target as HTMLTextAreaElement).select()}
          />
        </div>
      )}
    </div>
  );
}
