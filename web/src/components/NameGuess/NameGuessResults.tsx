import { useState } from "preact/hooks";
import type { Locale, NameGuessPuzzle } from "../../lib/quiz-types";
import type { GameStatus, LetterStatus, NameGuessTranslations } from "./types";

interface NameGuessResultsProps {
  puzzle: NameGuessPuzzle;
  guesses: string[];
  feedbacks: LetterStatus[][];
  status: GameStatus;
  locale: Locale;
  highContrast: boolean;
  t: NameGuessTranslations;
  onReset: () => void;
}

export function NameGuessResults({
  puzzle,
  guesses,
  feedbacks,
  status,
  locale,
  highContrast,
  t,
  onReset,
}: NameGuessResultsProps) {
  const [copied, setCopied] = useState(false);
  const won = status === "won";
  const target = puzzle.target;
  const targetDisplayName = target.labels[locale] || target.canonical_name;

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
    <div
      role="region"
      aria-label={t.resultsAria}
      class="result name-guess-result"
    >
      <h2 class={`result-title ${won ? "is-won" : "is-lost"}`}>
        {won ? t.wonTitle : t.lostTitle}
      </h2>

      <div>
        <p class="result-summary">
          {t.targetWas}
        </p>
        <p class="name-guess-target-name">
          {targetDisplayName}
        </p>
      </div>

      {target.clues && (
        <div class="callout name-guess-hints">
          <h3 class="name-guess-hints-title">
            {t.hints}
          </h3>
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

      <div class="btn-row">
        <button
          type="button"
          onClick={handleCopy}
          class="btn btn-primary"
        >
          {copied ? t.copied : t.copyResults}
        </button>
        <button
          type="button"
          onClick={onReset}
          class="btn btn-secondary"
        >
          {t.playAgain}
        </button>
      </div>
    </div>
  );
}
