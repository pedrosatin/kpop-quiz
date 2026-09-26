import type { Ref } from "preact";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { cellKey, type GridCellState } from "./types";
import { GridReview } from "./GridReview";

export interface GridResultsProps {
  grid: IntersectionGrid;
  cellStates: Record<string, GridCellState>;
  guessesUsed: number;
  /** Verdict of the guess that ended the game in this visit, if any. */
  verdict?: string | null;
  onRestart: () => void;
  onCopied?: () => void;
  onShareFailed?: () => void;
  titleRef?: Ref<HTMLHeadingElement>;
  locale: Locale;
  messages: Messages;
}

/** How long the result buttons ignore activation after they replace the counters. */
export const RESULT_GUARD_MS = 300;

export function gridShareText(
  grid: IntersectionGrid,
  cellStates: Record<string, GridCellState>,
  guessesUsed: number,
  monochrome: boolean,
  messages: Messages,
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
  return `${messages.gridShareHeader(grid.reference_date, correct, guessesUsed)}\n${lines.join("\n")}`;
}

/**
 * End of the game, shown in the action bar in place of the counters. The
 * bar keeps the verdict and the buttons; the answers and sources of every
 * cell open below them on request, so the finished board stays in view.
 */
export function GridResults({
  grid,
  cellStates,
  guessesUsed,
  verdict,
  onRestart,
  onCopied,
  onShareFailed,
  titleRef,
  locale,
  messages,
}: GridResultsProps) {
  const [monochrome, setMonochrome] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const summaryId = useId();
  const sourceId = useId();
  const shareFailedId = useId();
  const source = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);

  // The buttons appear where the counters were, right after the last pick,
  // so a second tap or a held Enter must not share or restart the game.
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, []);
  const guarded = (action: () => void) => () => {
    if (performance.now() - shownAt.current >= RESULT_GUARD_MS) action();
  };
  const ignoreRepeat = (event: KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  // The bar stops being sticky while the panel is open, so the panel can
  // open below the fold; bring it into view.
  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  const correctCount = useMemo(
    () => Object.values(cellStates).filter((c) => c.solved).length,
    [cellStates],
  );
  const shareText = gridShareText(grid, cellStates, guessesUsed, monochrome, messages);

  // The share sheet first, where there is one; a player who closes it has not
  // hit an error. Then the clipboard. If neither takes the text, the text
  // shows in a field the player can select and copy by hand.
  const handleShare = async () => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (typeof nav?.share === "function") {
      try {
        await nav.share({ text: shareText });
        return;
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      }
    }
    try {
      if (typeof nav?.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await nav.clipboard.writeText(shareText);
    } catch {
      setShareFailed(true);
      onShareFailed?.();
      return;
    }
    setShareFailed(false);
    setCopied(true);
    onCopied?.();
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, 3000);
  };

  return (
    <section class="grid-result" aria-labelledby={titleId}>
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
        <button type="button" class="btn btn-primary" onKeyDown={ignoreRepeat} onClick={guarded(handleShare)}>
          {copied ? messages.copiedToClipboard : messages.gridShareButton}
        </button>
        <button type="button" class="btn btn-secondary" onKeyDown={ignoreRepeat} onClick={guarded(onRestart)}>
          {messages.gridRestart}
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

      {/* Rendered on request: the busiest cells cite hundreds of places. */}
      <div ref={source} id={sourceId} class="grid-source" hidden={!sourceOpen}>
        {sourceOpen && <GridReview grid={grid} cellStates={cellStates} locale={locale} messages={messages} />}
      </div>
    </section>
  );
}
