import { useEffect, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WORD_SEARCH_I18N } from "./types";
import { formatTime, generateWordSearchShareSummary } from "./utils";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchResultModalProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  foundCount: number;
  totalCount: number;
  elapsedSeconds: number;
  onClose: () => void;
}

export function WordSearchResultModal({
  puzzle,
  locale,
  foundCount,
  totalCount,
  elapsedSeconds,
  onClose,
}: WordSearchResultModalProps) {
  const t = WORD_SEARCH_I18N[locale];
  const [copied, setCopied] = useState<boolean>(false);
  const shareBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    shareBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleShare = async () => {
    const text = generateWordSearchShareSummary(
      puzzle,
      foundCount,
      totalCount,
      elapsedSeconds
    );
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="modal-card result-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-dialog-title"
      >
        <div class="modal-header">
          <h2 id="result-dialog-title" class="modal-title">
            {t.congratulations}
          </h2>
          <button
            type="button"
            class="modal-close-btn"
            onClick={onClose}
            aria-label={t.close}
          >
            ✕
          </button>
        </div>

        <div class="modal-body">
          <p class="result-summary-message">{t.allWordsFound}</p>

          <div class="result-metrics">
            <div class="metric-item">
              <span class="metric-label">{t.wordsFound}</span>
              <strong class="metric-val">{foundCount} / {totalCount}</strong>
            </div>
            <div class="metric-item">
              <span class="metric-label">{t.elapsedTime}</span>
              <strong class="metric-val">{formatTime(elapsedSeconds)}</strong>
            </div>
          </div>

          <div class="result-share-box">
            <pre class="share-preview">
              {generateWordSearchShareSummary(
                puzzle,
                foundCount,
                totalCount,
                elapsedSeconds
              )}
            </pre>
            <button
              ref={shareBtnRef}
              type="button"
              class="share-btn primary-btn"
              onClick={handleShare}
            >
              {copied ? t.copied : t.shareResult}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
