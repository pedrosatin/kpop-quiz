import { useEffect, useRef, useState } from "preact/hooks";
import type { ConnectionsResultsProps } from "./types";
import { DIFFICULTY_COLORS } from "./types";
import { getMessages } from "../../i18n/catalog";

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
  const messages = getMessages(locale);
  const resultLine = messages.connectionsShareResultLine(solvedCount);
  const attemptsLine = messages.connectionsShareGuessesLine(attempts, mistakesUsed);

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
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

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
      class="result connections-results"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connections-result-title"
    >
      <h2
        id="connections-result-title"
        ref={titleRef}
        tabIndex={-1}
        class={`result-title ${isWon ? "is-won" : "is-lost"}`}
      >
        {title}
      </h2>
      <p class="result-summary">{summary}</p>

      <div class="share-box">
        <label class="share-toggle">
          <input
            type="checkbox"
            checked={monochrome}
            onChange={(e) => setMonochrome((e.target as HTMLInputElement).checked)}
          />
          <span>{messages.connectionsHighContrastShare}</span>
        </label>

        <pre class="share-preview" aria-label={messages.shareTextLabel}>
          {shareText}
        </pre>

        <div class="btn-row">
          <button type="button" class="btn btn-primary" onClick={handleCopy}>
            {messages.connectionsShareButton}
          </button>
          <button type="button" class="btn btn-secondary" onClick={onRestart}>
            {messages.connectionsRestart}
          </button>
        </div>

        <p class="share-feedback" role="status" aria-live="polite">
          {copied && messages.copiedToClipboard}
        </p>
      </div>
    </section>
  );
}
