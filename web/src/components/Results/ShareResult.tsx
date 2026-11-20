import { useEffect, useState } from "preact/hooks";
import type { Locale, PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { seoShareUrl } from "../../lib/seo-routes";
import { canUseClipboardWrite, canUseNativeShare, withShareUrl } from "./share-text";
import { useGameShareAction } from "./use-game-share-action";

export interface GenerateShareTextParams {
  correctCount: number;
  totalQuestions: number;
  results: boolean[];
  playMode: PlayMode;
  cluesUsedCount: number;
  elapsedSeconds: number;
  messages: Messages;
  locale: Locale;
  dailyDate?: string | null | undefined;
  /** Overrides the default home-quiz share URL (used by group landing pages). */
  shareUrl?: string | undefined;
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
  locale,
  dailyDate,
  shareUrl,
}: GenerateShareTextParams): string {
  const header = dailyDate
    ? messages.shareDailyHeader(dailyDate, correctCount, totalQuestions)
    : `K-pop Quiz ${correctCount}/${totalQuestions}`;
  const squares = formatSquares(results);
  const details = `${messages.difficultyName(playMode)} · ${messages.shareHints(cluesUsedCount)} · ${formatDuration(elapsedSeconds)}`;
  return withShareUrl(`${header}\n${squares}\n${details}`, shareUrl ?? seoShareUrl("quiz", locale));
}

export interface ShareResultProps {
  correctCount: number;
  totalQuestions: number;
  results: boolean[];
  playMode: PlayMode;
  cluesUsedCount: number;
  elapsedSeconds: number;
  messages: Messages;
  locale: Locale;
  dailyDate?: string | null | undefined;
  /** Overrides the default home-quiz share URL (used by group landing pages). */
  shareUrl?: string | undefined;
}

export function ShareResult({
  correctCount,
  totalQuestions,
  results,
  playMode,
  cluesUsedCount,
  elapsedSeconds,
  messages,
  locale,
  dailyDate,
  shareUrl,
}: ShareResultProps) {
  const [canShare, setCanShare] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const { copied, shareFailed, handleShare } = useGameShareAction({
    analytics: {
      game: "quiz",
      locale,
      mode: playMode,
      daily: dailyDate ? "yes" : "no",
    },
    onShareFailed: () => setShowFallback(true),
  });

  useEffect(() => {
    const hasShare = canUseNativeShare();
    const hasCopy = canUseClipboardWrite();
    setCanShare(hasShare);
    setCanCopy(hasCopy);
    if (!hasShare && !hasCopy) {
      setShowFallback(true);
    }
  }, []);

  useEffect(() => {
    if (shareFailed) setShowFallback(true);
  }, [shareFailed]);

  const shareText = generateShareText({
    correctCount,
    totalQuestions,
    results,
    playMode,
    cluesUsedCount,
    elapsedSeconds,
    messages,
    locale,
    dailyDate,
    ...(shareUrl !== undefined ? { shareUrl } : {}),
  });

  return (
    <div class="share-result">
      {(!showFallback || canShare || canCopy) && (
        <button
          type="button"
          class="btn btn-secondary share-button"
          onClick={() => {
            void handleShare(shareText);
          }}
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
            class="share-preview"
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
