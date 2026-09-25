import type { RefObject } from "preact";
import type { PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import type { QuestionResult } from "./types";
import { ScoreSummary } from "../Results/ScoreSummary";
import { ShareResult } from "../Results/ShareResult";
import { ReviewAnswers } from "../Results/ReviewAnswers";

export interface QuizResultProps {
  score: number;
  messages: Messages;
  headingRef?: RefObject<HTMLHeadingElement>;
  onRestart: () => void;
  totalQuestions?: number;
  correctCount?: number;
  elapsedSeconds?: number;
  cluesUsedCount?: number;
  playMode?: PlayMode;
  history?: QuestionResult[];
  dailyDate?: string | null | undefined;
}

export function QuizResult({
  score,
  messages,
  headingRef,
  onRestart,
  totalQuestions,
  correctCount,
  elapsedSeconds = 0,
  cluesUsedCount,
  playMode = "standard",
  history = [],
  dailyDate,
}: QuizResultProps) {
  const total = totalQuestions ?? (history.length > 0 ? history.length : 10);
  const correct = correctCount ?? history.filter((h) => h.isCorrect).length;
  const clues = cluesUsedCount ?? history.reduce((acc, h) => acc + h.cluesUsedCount, 0);

  return (
    <section id="quiz" class="game-card result" aria-labelledby="result-heading">
      <p class="kicker">{messages.score}</p>
      <h2 id="result-heading" class="result-title" {...(headingRef ? { ref: headingRef } : {})} tabIndex={-1}>
        {messages.resultTitle}
      </h2>
      <ScoreSummary
        correctCount={correct}
        totalQuestions={total}
        score={score}
        elapsedSeconds={elapsedSeconds}
        cluesUsedCount={clues}
        messages={messages}
      />
      <div class="btn-row">
        <ShareResult
          correctCount={correct}
          totalQuestions={total}
          results={history.map((h) => h.isCorrect)}
          playMode={playMode}
          cluesUsedCount={clues}
          elapsedSeconds={elapsedSeconds}
          messages={messages}
          dailyDate={dailyDate}
        />
        <button class="btn btn-primary" type="button" onClick={onRestart}>
          {messages.restart}
        </button>
      </div>
      <ReviewAnswers items={history} messages={messages} />
    </section>
  );
}
