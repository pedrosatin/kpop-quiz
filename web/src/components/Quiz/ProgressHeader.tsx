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
      <div class="quiz-meta">
        <p>{counterText}</p>
        <p>
          {messages.score}: <strong>{score}</strong>
        </p>
        {timerVisible && (
          <p role="timer">
            {messages.time}: <strong>{secondsLeft}{messages.seconds}</strong>
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
