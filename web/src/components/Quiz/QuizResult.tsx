import { Feedback } from "../Feedback/Feedback";
import type { RefObject } from "preact";
import type { Locale, PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import type { QuestionResult } from "./types";
import { ScoreSummary } from "../Results/ScoreSummary";
import { generateShareText, ShareResult } from "../Results/ShareResult";
import { ReviewAnswers } from "../Results/ReviewAnswers";
import { DailyNext } from "../Results/DailyNext";

export interface QuizResultProps {
  score: number;
  messages: Messages;
  locale: Locale;
  headingRef?: RefObject<HTMLHeadingElement>;
  /** Play again; the daily theme offers the next daily game instead. */
  onRestart: () => void;
  totalQuestions?: number;
  correctCount?: number;
  elapsedSeconds?: number;
  cluesUsedCount?: number;
  playMode?: PlayMode;
  history?: QuestionResult[];
  dailyDate?: string | null | undefined;
  feedbackEligible?: boolean;
  /** Notice above the actions (e.g. replay will repeat the only ten questions). */
  notice?: string | undefined;
  /** On the daily result, opens the general quiz setup in place of Play again. */
  onPlayGeneral?: (() => void) | undefined;
  /**
   * On the finished daily result: opens the general setup without restoring a
   * saved general round, so the player can change mode.
   */
  onOpenSetup?: (() => void) | undefined;
  /** On the finished daily result: where a general round in this language stopped. */
  generalNote?: string | undefined;
  /** Overrides the default home-quiz share URL (used by group landing pages). */
  shareUrl?: string | undefined;
}

export function QuizResult({
  score,
  messages,
  locale,
  headingRef,
  onRestart,
  totalQuestions,
  correctCount,
  elapsedSeconds = 0,
  cluesUsedCount,
  playMode = "standard",
  history = [],
  dailyDate,
  feedbackEligible = true,
  notice,
  onPlayGeneral,
  onOpenSetup,
  generalNote,
  shareUrl,
}: QuizResultProps) {
  const total = totalQuestions ?? (history.length > 0 ? history.length : 10);
  const correct = correctCount ?? history.filter((h) => h.isCorrect).length;
  const clues = cluesUsedCount ?? history.reduce((acc, h) => acc + h.cluesUsedCount, 0);
  const results = history.map((h) => h.isCorrect);
  const dayShareText = dailyDate
    ? generateShareText({
        correctCount: correct,
        totalQuestions: total,
        results,
        playMode,
        cluesUsedCount: clues,
        elapsedSeconds,
        messages,
        locale,
        dailyDate,
        ...(shareUrl !== undefined ? { shareUrl } : {}),
      })
    : undefined;

  return (
    <section id="quiz" class="game-card game-card--wide result quiz-result" data-testid="game-result" aria-labelledby="result-heading">
      {/* From 60rem the title, text and buttons sit beside the stats, and the
          review below them runs in two columns. */}
      <div class="quiz-result-summary">
        <h2
          id="result-heading"
          class="result-title"
          data-feedback="result"
          {...(headingRef ? { ref: headingRef } : {})}
          tabIndex={-1}
        >
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
        {notice && <p class="game-actions-message" role="status" data-testid="quiz-replay-notice">{notice}</p>}
        {generalNote && (
          <p class="game-actions-message" role="status" data-testid="quiz-daily-done-general-note">
            {generalNote}
          </p>
        )}
        <div class="btn-row">
          <ShareResult
            correctCount={correct}
            totalQuestions={total}
            results={results}
            playMode={playMode}
            cluesUsedCount={clues}
            elapsedSeconds={elapsedSeconds}
            messages={messages}
            locale={locale}
            dailyDate={dailyDate}
            {...(shareUrl !== undefined ? { shareUrl } : {})}
          />
          {!dailyDate && (
            <button class="btn btn-primary" type="button" onClick={onRestart}>
              {messages.restart}
            </button>
          )}
          {dailyDate && onOpenSetup && (
            <button class="btn btn-secondary" type="button" data-testid="quiz-open-setup" onClick={onOpenSetup}>
              {messages.quizOpenSetup}
            </button>
          )}
          {dailyDate && onPlayGeneral && (
            <button class="btn btn-secondary" type="button" data-testid="quiz-play-general" onClick={onPlayGeneral}>
              {messages.quizPlayGeneral}
            </button>
          )}
        </div>
        {dailyDate && dayShareText ? (
          <DailyNext game="quiz" locale={locale} shareText={dayShareText} referenceDate={dailyDate} />
        ) : null}
      </div>
      {feedbackEligible && <Feedback locale={locale} />}
      <ReviewAnswers items={history} messages={messages} />
    </section>
  );
}
