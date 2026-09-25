import type { Messages } from "../../i18n/catalog";

export interface ProgressHeaderProps {
  currentIndex: number;
  totalQuestions: number;
  score: number;
  secondsLeft: number;
  timerVisible: boolean;
  messages: Messages;
}

export function ProgressHeader({
  currentIndex,
  totalQuestions,
  score,
  secondsLeft,
  timerVisible,
  messages,
}: ProgressHeaderProps) {
  const currentNumber = currentIndex + 1;
  const progress = totalQuestions > 0 ? (currentNumber / totalQuestions) * 100 : 0;
  const counterText = messages.questionCounter(currentNumber, totalQuestions);

  return (
    <header class="quiz-progress-header">
      <div class="game-hud quiz-hud">
        <p class="hud-item hud-value">{counterText}</p>
        <p class="hud-item">
          <span class="hud-label">{messages.score}:</span> <strong class="hud-value">{score}</strong>
        </p>
        {timerVisible && (
          <p class="hud-item" role="timer">
            <span class="hud-label">{messages.time}:</span> <strong class="hud-value">{secondsLeft}{messages.seconds}</strong>
          </p>
        )}
      </div>
      <div
        class="progress-track"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={totalQuestions}
        aria-valuenow={currentNumber}
        aria-label={counterText}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </header>
  );
}
