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
      <div class="result-stats">
        <div class="result-stat">
          <span class="result-stat-label">{messages.correctCountLabel}</span>
          <strong class="result-stat-value">{correctCount}/{totalQuestions}</strong>
        </div>
        <div class="result-stat">
          <span class="result-stat-label">{messages.score}</span>
          <strong class="result-stat-value">{score}</strong>
        </div>
        <div class="result-stat">
          <span class="result-stat-label">{messages.totalTime}</span>
          <strong class="result-stat-value">{formatDuration(elapsedSeconds)}</strong>
        </div>
        <div class="result-stat">
          <span class="result-stat-label">{messages.cluesUsed}</span>
          <strong class="result-stat-value">{cluesUsedCount}</strong>
        </div>
      </div>
      <p class="result-summary">{messages.resultText(score)}</p>
    </div>
  );
}
