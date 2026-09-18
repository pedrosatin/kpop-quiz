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
      class="w-full max-w-lg mx-auto my-4 p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 text-center"
    >
      <h2 class={`text-2xl font-black mb-2 ${won ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
        {won ? t.wonTitle : t.lostTitle}
      </h2>

      <p class="text-sm sm:text-base text-slate-600 dark:text-slate-400 mb-1">
        {t.targetWas}
      </p>
      <p class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-wider mb-4">
        {targetDisplayName}
      </p>

      {target.clues && (
        <div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-md text-left text-sm mb-4 border border-slate-200 dark:border-slate-700">
          <h3 class="font-bold text-slate-800 dark:text-slate-200 mb-1">
            {t.hints}
          </h3>
          {descriptionText && (
            <p class="text-slate-600 dark:text-slate-300 mb-2">
              {descriptionText}
            </p>
          )}
          <div class="grid grid-cols-2 gap-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            {target.clues.debut_year && (
              <div>
                <span class="font-semibold">{t.debutYear}</span> {target.clues.debut_year}
              </div>
            )}
            {agencyName && (
              <div>
                <span class="font-semibold">{t.agency}</span> {agencyName}
              </div>
            )}
            {target.clues.members_count && (
              <div>
                <span class="font-semibold">{t.members}</span> {target.clues.members_count}
              </div>
            )}
          </div>
          {primaryEvidence && (
            <div class="mt-2 text-xs">
              <a
                href={primaryEvidence.source_url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-blue-600 dark:text-blue-400 underline hover:text-blue-800"
              >
                {t.evidenceLink}
              </a>
            </div>
          )}
        </div>
      )}

      <div class="flex flex-col sm:flex-row gap-2 justify-center mt-4">
        <button
          type="button"
          onClick={handleCopy}
          class="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-md shadow transition cursor-pointer"
        >
          {copied ? t.copied : t.copyResults}
        </button>
        <button
          type="button"
          onClick={onReset}
          class="px-4 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-bold rounded-md transition cursor-pointer"
        >
          {t.playAgain}
        </button>
      </div>
    </div>
  );
}
