import { useState } from "preact/hooks";
import type { ConnectionsResultsProps } from "./types";
import { DIFFICULTY_COLORS } from "./types";

export function generateShareText({
  puzzle,
  guessHistory,
  mistakesRemaining,
  locale,
  monochrome,
}: {
  puzzle: ConnectionsResultsProps["puzzle"];
  guessHistory: string[][];
  mistakesRemaining: number;
  locale: ConnectionsResultsProps["locale"];
  monochrome: boolean;
}): string {
  const attempts = guessHistory.length;
  const mistakesUsed = 4 - mistakesRemaining;
  const solvedCount = puzzle.categories.filter((c) =>
    guessHistory.some((g) => c.item_ids.every((id) => g.includes(id)))
  ).length;

  const header = `K-pop Connections ${puzzle.reference_date}`;
  const isPt = locale === "pt-BR";
  const resultLine = isPt
    ? `Resultado: ${solvedCount}/4 grupos`
    : `Result: ${solvedCount}/4 groups`;
  const mistakesLabel = isPt
    ? `${mistakesUsed} ${mistakesUsed === 1 ? "erro" : "erros"}`
    : `${mistakesUsed} ${mistakesUsed === 1 ? "mistake" : "mistakes"}`;
  const attemptsLine = isPt
    ? `Tentativas: ${attempts} (${mistakesLabel})`
    : `Attempts: ${attempts} (${mistakesLabel})`;

  const rows = guessHistory.map((guess) => {
    return guess
      .map((itemId) => {
        const cat = puzzle.categories.find((c) => c.item_ids.includes(itemId));
        if (!cat) return "⬜";
        const diff = cat.difficulty_level;
        return monochrome ? DIFFICULTY_COLORS[diff].mono : DIFFICULTY_COLORS[diff].emoji;
      })
      .join("");
  });

  return `${header}\n${resultLine}\n${attemptsLine}\n\n${rows.join("\n")}`;
}

export function ConnectionsResults({
  puzzle,
  gameStatus,
  guessHistory,
  mistakesRemaining,
  onRestart,
  locale,
  messages,
}: ConnectionsResultsProps) {
  const [monochrome, setMonochrome] = useState(false);
  const [copied, setCopied] = useState(false);

  const isWon = gameStatus === "won";
  const title = isWon ? messages.connectionsGameOverWon : messages.connectionsGameOverLost;
  const mistakesUsed = 4 - mistakesRemaining;
  const summary = isWon
    ? messages.connectionsResultSummaryWon(mistakesUsed)
    : messages.connectionsResultSummaryLost;

  const shareText = generateShareText({
    puzzle,
    guessHistory,
    mistakesRemaining,
    locale,
    monochrome,
  });

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    } catch {}
  };

  return (
    <section
      class="connections-results"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connections-result-title"
    >
      <div class="connections-results-card">
        <h2 id="connections-result-title" class="connections-results-title">
          {title}
        </h2>
        <p class="connections-results-summary">{summary}</p>

        <div class="connections-share-box">
          <label class="connections-mono-toggle">
            <input
              type="checkbox"
              checked={monochrome}
              onChange={(e) => setMonochrome((e.target as HTMLInputElement).checked)}
            />
            <span>{messages.connectionsHighContrastShare}</span>
          </label>

          <pre
            class="connections-share-preview"
            aria-label={messages.shareTextLabel}
          >
            {shareText}
          </pre>

          <div class="connections-results-actions">
            <button
              type="button"
              class="connections-btn connections-btn-primary"
              onClick={handleCopy}
            >
              {messages.connectionsShareButton}
            </button>
            <button
              type="button"
              class="connections-btn connections-btn-secondary"
              onClick={onRestart}
            >
              {messages.connectionsRestart}
            </button>
          </div>

          <div
            class="connections-copied-notice"
            role="status"
            aria-live="polite"
          >
            {copied && messages.copiedToClipboard}
          </div>
        </div>
      </div>
    </section>
  );
}
