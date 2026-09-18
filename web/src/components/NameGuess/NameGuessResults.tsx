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

  return (
    <div
      role="region"
      aria-label={t.resultsAria}
      class={`name-guess-results name-guess-modal ${highContrast ? "high-contrast" : ""}`.trim()}
      data-contrast={highContrast ? "high" : "normal"}
    >
      <h2 class={`name-guess-results-title ${won ? "is-won" : "is-lost"}`}>
        {won ? t.wonTitle : t.lostTitle}
      </h2>

      <p class="name-guess-target-prompt">
        {t.targetWas}
      </p>
      <p class="name-guess-target-name">
        {targetDisplayName}
      </p>

      {target.clues && (
        <div class="name-guess-hints-card">
          <h3 class="name-guess-hints-title">
            {t.hints}
          </h3>
          {descriptionText && (
            <p class="name-guess-hints-desc">
              {descriptionText}
            </p>
          )}
          <div class="name-guess-hints-grid">
            {target.clues.debut_year && (
              <div class="name-guess-hint-item">
                <span class="hint-label">{t.debutYear}</span> <span class="hint-value">{target.clues.debut_year}</span>
              </div>
            )}
            {agencyName && (
              <div class="name-guess-hint-item">
                <span class="hint-label">{t.agency}</span> <span class="hint-value">{agencyName}</span>
              </div>
            )}
            {target.clues.members_count && (
              <div class="name-guess-hint-item">
                <span class="hint-label">{t.members}</span> <span class="hint-value">{target.clues.members_count}</span>
              </div>
            )}
          </div>
          {primaryEvidence && (
            <div class="name-guess-evidence">
              <a
                href={primaryEvidence.source_url}
                target="_blank"
                rel="noopener noreferrer"
                class="evidence-link"
              >
                {t.evidenceLink}
              </a>
            </div>
          )}
        </div>
      )}

      <div class="name-guess-results-actions">
        <button
          type="button"
          onClick={handleCopy}
          class="name-guess-share-btn"
        >
          {copied ? t.copied : t.copyResults}
        </button>
        <button
          type="button"
          onClick={onReset}
          class="name-guess-reset-btn"
        >
          {t.playAgain}
        </button>
      </div>
    </div>
  );
}
