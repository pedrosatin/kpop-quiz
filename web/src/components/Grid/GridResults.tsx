import type { Ref } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { cellKey, type GridCellState } from "./types";
import { GridReview } from "./GridReview";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";
import { useGameShareAction } from "../Results/use-game-share-action";
import { useResultActionGuard } from "../Results/use-result-action-guard";
import { DailyNext } from "../Results/DailyNext";
export { RESULT_GUARD_MS } from "../Results/use-result-action-guard";

export interface GridResultsProps {
  grid: IntersectionGrid;
  /** Publication day shown in the share header (ADR 047). */
  challengeDate: string;
  cellStates: Record<string, GridCellState>;
  guessesUsed: number;
  /** Verdict of the guess that ended the game in this visit, if any. */
  verdict?: string | null;
  /** When the game ended by give-up, the answers open revealed. */
  gaveUp?: boolean;
  onCopied?: () => void;
  onShareFailed?: () => void;
  titleRef?: Ref<HTMLHeadingElement>;
  locale: Locale;
  messages: Messages;
}

export function gridShareText(
  grid: IntersectionGrid,
  cellStates: Record<string, GridCellState>,
  guessesUsed: number,
  monochrome: boolean,
  messages: Messages,
  locale: Locale,
  challengeDate: string = grid.reference_date,
): string {
  const lines: string[] = [];
  for (let r = 0; r < 3; r++) {
    let row = "";
    for (let c = 0; c < 3; c++) {
      const solved = cellStates[cellKey(r, c)]?.solved;
      row += monochrome ? (solved ? "■" : "□") : solved ? "🟩" : "🟥";
    }
    lines.push(row);
  }
  const correct = Object.values(cellStates).filter((c) => c.solved).length;
  return withShareUrl(
    `${messages.gridShareHeader(challengeDate, correct, guessesUsed)}\n${lines.join("\n")}`,
    seoShareUrl("grid", locale),
  );
}

/**
 * End of the game, shown in the action bar in place of the counters. The
 * bar keeps the verdict and the buttons; the answers and sources of every
 * cell open below them on request, so the finished board stays in view.
 */
export function GridResults({
  grid,
  challengeDate,
  cellStates,
  guessesUsed,
  verdict,
  gaveUp = false,
  onCopied,
  onShareFailed,
  titleRef,
  locale,
  messages,
}: GridResultsProps) {
  const [monochrome, setMonochrome] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(gaveUp);
  const titleId = useId();
  const summaryId = useId();
  const sourceId = useId();
  const shareFailedId = useId();
  const source = useRef<HTMLDivElement>(null);
  const { guarded, ignoreRepeat } = useResultActionGuard();
  const { copied, shareFailed, handleShare } = useGameShareAction({ onCopied, onShareFailed, analytics: { game: "grid", locale, daily: "yes" } });

  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  const correctCount = useMemo(
    () => Object.values(cellStates).filter((c) => c.solved).length,
    [cellStates],
  );
  const shareText = gridShareText(grid, cellStates, guessesUsed, monochrome, messages, locale, challengeDate);

  return (
    <section class="grid-result" data-testid="game-result" aria-labelledby={titleId}>
      <div class="grid-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          aria-describedby={summaryId}
          class="game-actions-title grid-result-title"
        >
          {messages.gridGameOverTitle}
        </h2>
        <p id={summaryId} class="grid-result-summary">
          {verdict ? `${verdict} ` : ""}
          {messages.gridGameOverSummary(correctCount, guessesUsed)}
        </p>
      </div>

      <div class="grid-result-buttons">
        <button type="button" class="btn btn-primary" onKeyDown={ignoreRepeat} onClick={guarded(() => { void handleShare(shareText); })}>
          {copied ? messages.copiedToClipboard : messages.gridShareButton}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          aria-expanded={sourceOpen}
          aria-controls={sourceId}
          onKeyDown={ignoreRepeat}
          onClick={guarded(() => setSourceOpen((open) => !open))}
        >
          {sourceOpen ? messages.hideSource : messages.showSource}
        </button>
      </div>

      <DailyNext game="grid" locale={locale} shareText={shareText} referenceDate={challengeDate} />

      <label class="share-toggle grid-share-toggle">
        <input
          type="checkbox"
          checked={monochrome}
          onChange={(e) => setMonochrome((e.target as HTMLInputElement).checked)}
        />
        <span>{messages.gridHighContrastShare}</span>
      </label>

      {shareFailed && (
        <div class="grid-share-fallback">
          <p id={shareFailedId}>{messages.shareFailed}</p>
          <textarea
            class="share-preview"
            readOnly
            rows={4}
            value={shareText}
            aria-label={messages.shareTextLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      <div ref={source} id={sourceId} class="grid-source source-panel" hidden={!sourceOpen}>
        {sourceOpen && <GridReview grid={grid} cellStates={cellStates} locale={locale} messages={messages} />}
      </div>
    </section>
  );
}
