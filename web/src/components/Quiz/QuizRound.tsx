import type { RefObject } from "preact";
import type { PlayMode, QuizQuestion, QuizSession } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { ProgressHeader } from "./ProgressHeader";
import { QuestionCard } from "./QuestionCard";
import { LicensedMedia } from "./LicensedMedia";
import { HintTray } from "./HintTray";
import { AnswerFeedback } from "./AnswerFeedback";

export interface QuizRoundProps {
  session?: QuizSession | undefined;
  question: QuizQuestion;
  questionIndex?: number | undefined;
  score?: number | undefined;
  secondsLeft?: number | undefined;
  timerVisible?: boolean | undefined;
  selectedId: string | null;
  onSelectOption: (id: string) => void;
  answered: boolean;
  timedOut?: boolean | undefined;
  revealedClues?: string[] | undefined;
  playMode: PlayMode;
  headingRef?: RefObject<HTMLHeadingElement> | undefined;
  feedbackRef?: RefObject<HTMLDivElement> | undefined;
  onSubmit: () => void;
  onAdvance?: () => void | undefined;
  onRevealClue: () => void;
  messages: Messages;
}

export function QuizRound({
  session,
  question,
  questionIndex = 0,
  score = 0,
  secondsLeft = 0,
  timerVisible = false,
  selectedId,
  onSelectOption,
  answered,
  timedOut = false,
  revealedClues = [],
  playMode,
  headingRef,
  feedbackRef,
  onSubmit,
  onAdvance = () => {},
  onRevealClue,
  messages,
}: QuizRoundProps) {
  const totalQuestions = session?.questions?.length ?? 1;

  return (
    <section id="quiz" class="quiz-card" aria-labelledby="question-heading">
      <ProgressHeader
        currentIndex={questionIndex}
        totalQuestions={totalQuestions}
        score={score}
        secondsLeft={secondsLeft}
        timerVisible={timerVisible}
        messages={messages}
      />
      <QuestionCard
        {...(headingRef ? { headingRef } : {})}
        prompt={question.prompt}
        options={question.options}
        selectedOptionId={selectedId}
        onSelectOption={onSelectOption}
        answered={answered}
        correctOptionId={question.answer_option_id}
        onSubmit={onSubmit}
        submitLabel={messages.check}
        legendLabel={messages.chooseAnswer}
      >
        <LicensedMedia
          media={question.media}
          isAnswered={answered}
          messages={messages}
        />
        <HintTray
          playMode={playMode}
          cluesAvailable={question.clues_available}
          cluesShown={question.clues_shown}
          revealedClues={revealedClues}
          hintCost={question.hint_cost}
          answered={answered}
          onRevealClue={onRevealClue}
          messages={messages}
        />
      </QuestionCard>
      {answered && (
        <AnswerFeedback
          {...(feedbackRef ? { feedbackRef } : {})}
          isCorrect={!timedOut && selectedId === question.answer_option_id}
          timedOut={timedOut}
          correctOption={question.options.find((opt) => opt.id === question.answer_option_id) ?? null}
          explanation={question.explanation}
          evidence={question.evidence}
          messages={messages}
          isLastQuestion={questionIndex === totalQuestions - 1}
          onAdvance={onAdvance}
        />
      )}
    </section>
  );
}
