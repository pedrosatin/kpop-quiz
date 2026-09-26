import type { RefObject } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Locale, NameGuessPuzzle } from "../../lib/quiz-types";
import type { GameStatus, LetterStatus, NameGuessTranslations } from "./types";

/** How long the result buttons ignore activation after they replace the keyboard. */
export const RESULT_GUARD_MS = 300;

interface NameGuessResultsProps {
  puzzle: NameGuessPuzzle;
  guesses: string[];
  feedbacks: LetterStatus[][];
  status: GameStatus;
  locale: Locale;
  highContrast: boolean;
  t: NameGuessTranslations;
  onReset: () => void;
  titleRef?: RefObject<HTMLHeadingElement> | undefined;
}

/**
 * End of game, shown in the action bar in place of the keyboard. The bar
 * keeps the verdict, the answer and the buttons; the clues and the source
 * open below them on request, so the final board stays in view.
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
  titleRef,
}: NameGuessResultsProps) {
  const [copied, setCopied] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const titleId = useId();
  const hintsId = useId();
  const shownAt = useRef(0);
  const won = status === "won";
  const target = puzzle.target;
  const targetDisplayName = target.labels[locale] || target.canonical_name;

  // The buttons appear where the keyboard was, so a second tap or a held key
  // meant for the last guess must not share or restart the game.
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, []);
  const guarded = (action: () => void) => () => {
    if (performance.now() - shownAt.current >= RESULT_GUARD_MS) action();
  };
  const ignoreRepeat = (event: KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  function generateShareText(): string {
    const scoreText = won ? `${guesses.length}/${puzzle.max_attempts}` : `X/${puzzle.max_attempts}`;
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

  async function handleCopy() {
    const text = generateShareText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
    }
  }

  const agencyName =
    typeof target.clues?.agency === "object"
      ? target.clues.agency[locale]
      : target.clues?.agency;

  const descriptionText = target.clues?.description?.[locale];
  const primaryEvidence = target.evidence[0];

  const hasStats = Boolean(target.clues?.debut_year || agencyName || target.clues?.members_count);

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
          onClick={guarded(handleCopy)}
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
        {target.clues && (
          <button
            type="button"
            class="btn btn-secondary"
            aria-expanded={hintsOpen}
            aria-controls={hintsId}
            onClick={() => setHintsOpen((open) => !open)}
          >
            {t.hints}
          </button>
        )}
      </div>

      {target.clues && (
        <div id={hintsId} class="callout name-guess-hints" hidden={!hintsOpen}>
          {descriptionText && (
            <p class="name-guess-hints-desc">
              {descriptionText}
            </p>
          )}
          {hasStats && (
            <div class="result-stats">
              {target.clues.debut_year && (
                <div class="result-stat">
                  <span class="result-stat-label">{t.debutYear}</span> <strong class="result-stat-value">{target.clues.debut_year}</strong>
                </div>
              )}
              {agencyName && (
                <div class="result-stat">
                  <span class="result-stat-label">{t.agency}</span> <strong class="result-stat-value name-guess-stat-text">{agencyName}</strong>
                </div>
              )}
              {target.clues.members_count && (
                <div class="result-stat">
                  <span class="result-stat-label">{t.members}</span> <strong class="result-stat-value">{target.clues.members_count}</strong>
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
