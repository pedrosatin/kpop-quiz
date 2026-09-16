import type { Messages } from "../../i18n/catalog";
import { formatDuration } from "./ShareResult";

export interface ScoreSummaryProps {
  correctCount: number;
  totalQuestions: number;
  score: number;
  elapsedSeconds: number;
  cluesUsedCount: number;
  messages: Messages;
}

export function ScoreSummary({
  correctCount,
  totalQuestions,
  score,
  elapsedSeconds,
  cluesUsedCount,
  messages,
}: ScoreSummaryProps) {
  return (
    <div class="score-summary">
      <div class="score-summary-grid">
        <div class="score-summary-item">
          <span class="score-summary-label">{messages.correctCountLabel}</span>
          <strong class="score-summary-value">{correctCount}/{totalQuestions}</strong>
        </div>
        <div class="score-summary-item">
          <span class="score-summary-label">{messages.score}</span>
          <strong class="score-summary-value">{score}</strong>
        </div>
        <div class="score-summary-item">
          <span class="score-summary-label">{messages.totalTime}</span>
          <strong class="score-summary-value">{formatDuration(elapsedSeconds)}</strong>
        </div>
        <div class="score-summary-item">
          <span class="score-summary-label">{messages.cluesUsed}</span>
          <strong class="score-summary-value">{cluesUsedCount}</strong>
        </div>
      </div>
      <p class="result-message">{messages.resultText(score)}</p>
    </div>
  );
}
