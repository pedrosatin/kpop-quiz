import type { RefObject } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Locale, NameGuessPuzzle } from "../../lib/quiz-types";
import type { GameStatus, LetterStatus, NameGuessTranslations } from "./types";
import { useGameShareAction } from "../Results/use-game-share-action";
import { useResultActionGuard } from "../Results/use-result-action-guard";
export { RESULT_GUARD_MS } from "../Results/use-result-action-guard";

/** The result as text: header, then one row of squares per guess. */
export function generateShareText({
  puzzle,
  feedbacks,
  won,
  attempts,
  highContrast,
}: {
  puzzle: NameGuessPuzzle;
  feedbacks: LetterStatus[][];
  won: boolean;
  attempts: number;
  highContrast: boolean;
}): string {
  const scoreText = won ? `${attempts}/${puzzle.max_attempts}` : `X/${puzzle.max_attempts}`;
  const lines = [`K-pop Guess ${puzzle.reference_date} ${scoreText}`, ""];

  for (const fb of feedbacks) {
    const row = fb
      .map((s) => {
        if (s === "correct") return highContrast ? "🟦" : "🟩";
        if (s === "present") return highContrast ? "🟧" : "🟨";
        return "⬛";
      })
      .join("");
    lines.push(row);
  }
  return lines.join("\n");
}

interface NameGuessResultsProps {
  puzzle: NameGuessPuzzle;
  guesses: string[];
  feedbacks: LetterStatus[][];
  status: GameStatus;
  locale: Locale;
  highContrast: boolean;
  t: NameGuessTranslations;
  onReset: () => void;
  /** Called after the clipboard took the result, so the bar can announce it. */
  onCopied?: () => void;
  /** Called when neither the share sheet nor the clipboard took the result. */
  onShareFailed?: () => void;
  titleRef?: RefObject<HTMLHeadingElement> | undefined;
}

/**
 * End of game, shown in the action bar in place of the keyboard. The bar
 * keeps the verdict, the answer and the buttons; the description, the stats
 * and the source open below them on request, so the final board stays in view.
 */
export function NameGuessResults({
  puzzle,
  guesses,
  feedbacks,
  status,
  locale,
  highContrast,
  t,
  onReset,
  onCopied,
  onShareFailed,
  titleRef,
}: NameGuessResultsProps) {
  const shareTextId = useId();
  const shareFailedId = useId();
  const fallback = useRef<HTMLDivElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  const details = useRef<HTMLDivElement>(null);
  const won = status === "won";
  const target = puzzle.target;
  const targetDisplayName = target.labels[locale] || target.canonical_name;
  // The buttons appear where the keyboard was, so a second tap or a held key
  // meant for the last guess must not share or restart the game.
  const { guarded, ignoreRepeat } = useResultActionGuard();
  const { copied, shareFailed, handleShare } = useGameShareAction({ onCopied, onShareFailed });

  // The bar stops being sticky while the panel is open, so the panel can open
  // below the fold; bring it into view. It is capped in height, so the board
  // stays on screen.
  useEffect(() => {
    if (detailsOpen) details.current?.scrollIntoView?.({ block: "nearest" });
  }, [detailsOpen]);

  // The field opens below the buttons; bring it into view.
  useEffect(() => {
    if (shareFailed) fallback.current?.scrollIntoView?.({ block: "nearest" });
  }, [shareFailed]);

  const shareText = generateShareText({ puzzle, feedbacks, won, attempts: guesses.length, highContrast });

  const clues = target.clues;
  const agencyName = typeof clues?.agency === "object" ? clues.agency[locale] : clues?.agency;
  const descriptionText = clues?.description?.[locale];
  const primaryEvidence = target.evidence[0];
  const hasStats = Boolean(clues?.debut_year || agencyName || clues?.members_count);
  // The source link does not depend on the clues, so either one opens the panel.
  const hasDetails = Boolean(clues || primaryEvidence);

  return (
    <section aria-labelledby={titleId} class="name-guess-result">
      <div class="name-guess-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          class={`game-actions-title name-guess-result-title ${won ? "is-won" : "is-lost"}`}
        >
          {won ? t.wonTitle : t.lostTitle}
        </h2>
        <p class="name-guess-answer">
          {t.targetWas} <strong class="name-guess-target-name">{targetDisplayName}</strong>
        </p>
      </div>

      <div class="name-guess-result-buttons">
        <button
          type="button"
          onKeyDown={ignoreRepeat}
          onClick={guarded(() => { void handleShare(shareText); })}
          class="btn btn-primary"
        >
          {copied ? t.copied : t.copyResults}
        </button>
        <button
          type="button"
          onKeyDown={ignoreRepeat}
          onClick={guarded(onReset)}
          class="btn btn-secondary"
        >
          {t.playAgain}
        </button>
        {hasDetails && (
          <button
            type="button"
            class="btn btn-secondary"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? t.hideSource : t.showSource}
          </button>
        )}
      </div>

      {shareFailed && (
        <div ref={fallback} class="name-guess-share-fallback">
          <p id={shareFailedId}>{t.shareFailed}</p>
          <textarea
            id={shareTextId}
            class="share-preview"
            readOnly
            rows={4}
            value={shareText}
            aria-label={t.shareTextLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      {hasDetails && (
        <div ref={details} id={detailsId} class="callout name-guess-hints" hidden={!detailsOpen}>
          {descriptionText && (
            <p class="name-guess-hints-desc">
              {descriptionText}
            </p>
          )}
          {clues && hasStats && (
            <div class="result-stats">
              {clues.debut_year && (
                <div class="result-stat">
                  <span class="result-stat-label">{t.debutYear}</span> <strong class="result-stat-value">{clues.debut_year}</strong>
                </div>
              )}
              {agencyName && (
                <div class="result-stat">
                  <span class="result-stat-label">{t.agency}</span> <strong class="result-stat-value name-guess-stat-text">{agencyName}</strong>
                </div>
              )}
              {clues.members_count && (
                <div class="result-stat">
                  <span class="result-stat-label">{t.members}</span> <strong class="result-stat-value">{clues.members_count}</strong>
                </div>
              )}
            </div>
          )}
          {primaryEvidence && (
            <p class="name-guess-evidence">
              <a
                href={primaryEvidence.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.evidenceLink}
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
