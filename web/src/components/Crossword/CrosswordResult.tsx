import type { Ref } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { CrosswordPuzzle } from "../../data/crossword";
import type { Messages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";
import { useGameShareAction } from "../Results/use-game-share-action";
import { useResultActionGuard } from "../Results/use-result-action-guard";
import { isEntrySolved, type CrosswordStatus } from "./crossword-save";

/**
 * Spoiler-free result: the game name, the verdict and one square per word in
 * clue order (green when the word was right, white otherwise). The board is a
 * fixed match, so the text carries no date or day number.
 */
export function generateCrosswordShareText(
  puzzle: CrosswordPuzzle,
  values: Readonly<Record<string, string>>,
  status: CrosswordStatus,
  checks: number,
  messages: Messages,
  locale: Locale,
): string {
  const solved = puzzle.entries.map((entry) => status === "won" || isEntrySolved(entry, values));
  const verdict = status === "won"
    ? messages.crosswordSummaryWon(checks)
    : messages.crosswordSummaryRevealed(solved.filter(Boolean).length, puzzle.entries.length);
  const squares = solved.map((ok) => (ok ? "🟩" : "⬜")).join("");
  return withShareUrl(`K-pop Crossword\n${verdict}\n${squares}`, seoShareUrl("crossword", locale));
}

interface CrosswordResultProps {
  puzzle: CrosswordPuzzle;
  locale: Locale;
  messages: Messages;
  values: Readonly<Record<string, string>>;
  status: CrosswordStatus;
  checks: number;
  correctWords: number;
  titleRef?: Ref<HTMLHeadingElement>;
  onRestart: () => void;
  onCopied: () => void;
  onShareFailed: () => void;
}

/**
 * End of the round, shown in the action bar in place of the controls: the
 * verdict, Share, Show source and Play again. The cited clues open below on
 * request, so the solved grid stays in view.
 */
export function CrosswordResult({
  puzzle,
  locale,
  messages,
  values,
  status,
  checks,
  correctWords,
  titleRef,
  onRestart,
  onCopied,
  onShareFailed,
}: CrosswordResultProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const titleId = useId();
  const summaryId = useId();
  const sourceId = useId();
  const shareTextId = useId();
  const shareFailedId = useId();
  const source = useRef<HTMLDivElement>(null);
  const { guarded, ignoreRepeat } = useResultActionGuard();
  const { copied, shareFailed, handleShare } = useGameShareAction({
    analytics: { game: "crossword", locale },
    onCopied,
    onShareFailed,
  });
  const shareText = generateCrosswordShareText(puzzle, values, status, checks, messages, locale);
  const won = status === "won";

  // The bar stops being sticky while the panel is open; bring the panel into view.
  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  return (
    <section class="crossword-result" data-testid="game-result" aria-labelledby={titleId}>
      <div class="crossword-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          aria-describedby={summaryId}
          class={`game-actions-title crossword-result-title ${won ? "is-won" : "is-lost"}`}
        >
          {won ? messages.crosswordResultWon : messages.crosswordResultRevealed}
        </h2>
        <p id={summaryId} class="crossword-result-summary">
          {won ? messages.crosswordSummaryWon(checks) : messages.crosswordSummaryRevealed(correctWords, puzzle.entries.length)}
        </p>
      </div>

      <div class="crossword-result-buttons">
        <button
          type="button"
          class="btn btn-primary"
          onKeyDown={ignoreRepeat}
          onClick={guarded(() => {
            void handleShare(shareText);
          })}
        >
          {copied ? messages.copiedToClipboard : messages.share}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          aria-expanded={sourceOpen}
          aria-controls={sourceId}
          onClick={() => setSourceOpen((open) => !open)}
        >
          {sourceOpen ? messages.hideSource : messages.showSource}
        </button>
        <button type="button" class="btn btn-secondary" onKeyDown={ignoreRepeat} onClick={guarded(onRestart)}>
          {messages.restart}
        </button>
      </div>

      {shareFailed && (
        <div class="crossword-share-fallback">
          <p id={shareFailedId}>{messages.shareFailed}</p>
          <textarea
            id={shareTextId}
            class="share-preview"
            readOnly
            rows={3}
            value={shareText}
            aria-label={messages.shareTextLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      <div ref={source} id={sourceId} class="crossword-source" hidden={!sourceOpen}>
        {puzzle.entries.map((entry) => (
          <div key={entry.qid} class="crossword-source-word">
            <h3 class="crossword-source-title">{entry.canonical_name}</h3>
            <p class="crossword-source-clue">
              <strong>{messages.crosswordSourceClue}</strong> {entry.clue[locale]}
            </p>
            <ul>
              {entry.sources.map((s) => {
                const revision = new URL(s.url).searchParams.get("oldid");
                return (
                  <li key={s.locator}>
                    {`Wikipedia, ${messages.revision} ${revision}.`}{" "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {messages.openRevision("Wikipedia")}
                    </a>
                    <span class="crossword-source-snippet">“{s.snippet}”</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p class="crossword-source-license">Wikipedia · CC BY-SA 4.0 · Wikidata · CC0</p>
      </div>
    </section>
  );
}
