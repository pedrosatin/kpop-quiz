import type { RefObject } from "preact";
import type { PlayMode, QuizQuestion, QuizSession } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { ProgressHeader } from "./ProgressHeader";
import { QuestionCard } from "./QuestionCard";
import { HintTray } from "./HintTray";
import { AnswerFeedback } from "./AnswerFeedback";

export interface QuizRoundProps {
  session: QuizSession;
  question: QuizQuestion;
  questionIndex: number;
  score: number;
  secondsLeft: number;
  timerVisible: boolean;
  selectedId: string | null;
  onSelectOption: (id: string) => void;
  answered: boolean;
  timedOut: boolean;
  revealedClues: string[];
  playMode: PlayMode;
  headingRef: RefObject<HTMLHeadingElement>;
  feedbackRef: RefObject<HTMLDivElement>;
  onSubmit: () => void;
  onAdvance: () => void;
  onRevealClue: () => void;
  messages: Messages;
}

export function QuizRound({
  session,
  question,
  questionIndex,
  score,
  secondsLeft,
  timerVisible,
  selectedId,
  onSelectOption,
  answered,
  timedOut,
  revealedClues,
  playMode,
  headingRef,
  feedbackRef,
  onSubmit,
  onAdvance,
  onRevealClue,
  messages,
}: QuizRoundProps) {
  return (
    <section id="quiz" class="quiz-card" aria-labelledby="question-heading">
      <ProgressHeader
        currentIndex={questionIndex}
        totalQuestions={session.questions.length}
        score={score}
        secondsLeft={secondsLeft}
        timerVisible={timerVisible}
        messages={messages}
      />
      <QuestionCard
        headingRef={headingRef}
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
          feedbackRef={feedbackRef}
          isCorrect={selectedId === question.answer_option_id}
          timedOut={timedOut}
          correctOption={question.options.find((opt) => opt.id === question.answer_option_id) ?? null}
          explanation={question.explanation}
          evidence={question.evidence}
          messages={messages}
          isLastQuestion={questionIndex === session.questions.length - 1}
          onAdvance={onAdvance}
        />
      )}
    </section>
  );
}
