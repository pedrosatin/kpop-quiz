import { useMemo, useState } from "preact/hooks";
import type { IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { cellKey, type GridCellState } from "./types";
import { GridReview } from "./GridReview";

export interface GridResultsProps {
  grid: IntersectionGrid;
  cellStates: Record<string, GridCellState>;
  guessesUsed: number;
  onRestart: () => void;
  locale: Locale;
  messages: Messages;
}

export function GridResults({
  grid,
  cellStates,
  guessesUsed,
  onRestart,
  locale,
  messages,
}: GridResultsProps) {
  const [monochrome, setMonochrome] = useState(false);
  const [copied, setCopied] = useState(false);

  const correctCount = useMemo(() => {
    return Object.values(cellStates).filter((c) => c.solved).length;
  }, [cellStates]);

  const matrixLines = useMemo(() => {
    const lines: string[] = [];
    for (let r = 0; r < 3; r++) {
      let rowSymbols = "";
      for (let c = 0; c < 3; c++) {
        const state = cellStates[cellKey(r, c)];
        if (monochrome) {
          rowSymbols += state?.solved ? "■" : "□";
        } else {
          rowSymbols += state?.solved ? "🟩" : "🟥";
        }
      }
      lines.push(rowSymbols);
    }
    return lines;
  }, [cellStates, monochrome]);

  const shareText = useMemo(() => {
    const header = messages.gridShareHeader(grid.reference_date, correctCount, guessesUsed);
    return `${header}\n${matrixLines.join("\n")}`;
  }, [messages, grid.reference_date, correctCount, guessesUsed, matrixLines]);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 4000);
      }
    } catch {
      setCopied(false);
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: messages.gridTitle,
          text: shareText,
        });
      } catch {
        // User canceled share
      }
    } else {
      await handleCopy();
    }
  };

  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <section class="grid-results-container" aria-labelledby="grid-gameover-title">
      <header class="grid-results-header">
        <p class="kicker">{messages.gridEyebrow}</p>
        <h2 id="grid-gameover-title">{messages.gridGameOverTitle}</h2>
        <p class="results-summary-text">
          {messages.gridGameOverSummary(correctCount, guessesUsed)}
        </p>
      </header>

      <div class="grid-share-card">
        <div class="share-matrix-preview" aria-label="Matriz de resultado" role="img">
          {matrixLines.map((line, idx) => (
            <div key={idx} class="share-matrix-row">
              {line}
            </div>
          ))}
        </div>

        <div class="share-options">
          <label class="monochrome-toggle">
            <input
              type="checkbox"
              checked={monochrome}
              onChange={(e) => setMonochrome((e.target as HTMLInputElement).checked)}
            />
            <span>{messages.gridHighContrastShare}</span>
          </label>
        </div>

        <div class="share-actions">
          {hasNativeShare && (
            <button type="button" class="btn btn-primary" onClick={handleShare}>
              {messages.gridShareButton}
            </button>
          )}
          <button
            type="button"
            class={`btn ${hasNativeShare ? "btn-secondary" : "btn-primary"}`}
            onClick={handleCopy}
          >
            {messages.gridCopyButton}
          </button>
          <button type="button" class="btn btn-secondary" onClick={onRestart}>
            {messages.gridRestart}
          </button>
        </div>

        <div class="visually-hidden" aria-live="polite" aria-atomic="true">
          {copied && messages.gridCopiedNotice}
        </div>
        {copied && (
          <p class="copy-feedback-alert" role="status">
            {messages.gridCopiedNotice}
          </p>
        )}
      </div>

      <GridReview grid={grid} cellStates={cellStates} locale={locale} messages={messages} />
    </section>
  );
}
