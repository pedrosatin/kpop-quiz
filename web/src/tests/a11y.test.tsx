import { cleanup, render } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GameSetup } from "../components/GameSetup/GameSetup";
import { GameCollection } from "../components/GameSetup/GameCollection";
import { QuestionCard } from "../components/Quiz/QuestionCard";
import { ProgressHeader } from "../components/Quiz/ProgressHeader";
import { HintTray } from "../components/Quiz/HintTray";
import { LicensedMedia } from "../components/Quiz/LicensedMedia";
import { AnswerFeedback } from "../components/Quiz/AnswerFeedback";
import { QuizResult } from "../components/Quiz/QuizResult";
import { QuizState } from "../components/Quiz/QuizState";
import { QuizRound } from "../components/Quiz/QuizRound";
import { ScoreSummary } from "../components/Results/ScoreSummary";
import { ShareResult } from "../components/Results/ShareResult";
import { ReviewAnswers } from "../components/Results/ReviewAnswers";
import { getMessages } from "../i18n/catalog";
import type { LicensedMedia as LicensedMediaType, QuizOption, QuizQuestion } from "../lib/quiz-types";
import type { QuestionResult } from "../components/Quiz/types";

const ptMessages = getMessages("pt-BR");

const sampleMedia: LicensedMediaType = {
  asset_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Twice_photo.jpg/960px-Twice_photo.jpg",
  source_url: "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg",
  creator: "Dispatch",
  license_name: "CC BY 3.0",
  license_url: "https://creativecommons.org/licenses/by/3.0/",
  subject_qid: "Q21461452",
  verified_at: "2026-01-15",
  transformations: ["crop 4:5", "resize 960x1200"],
};

const sampleOptions: QuizOption[] = [
  { id: "opt-1", label: "TWICE", value: "Q21461452", value_type: "group" },
  { id: "opt-2", label: "BLACKPINK", value: "Q250567", value_type: "group" },
  { id: "opt-3", label: "Red Velvet", value: "Q17488584", value_type: "group" },
  { id: "opt-4", label: "ITZY", value: "Q60737153", value_type: "group" },
];

const sampleEvidence = [
  {
    fact_base_id: "fb-1",
    locator: "wikidata:Q21461452:P571",
    revision_id: 123456,
    source_key: "domain:wikidata.org",
    source_url: "https://www.wikidata.org/wiki/Q21461452",
  },
];

const sampleQuestion: QuizQuestion = {
  id: "q-1",
  logical_id: "q-logic-1",
  base_logical_id: "q-base-1",
  semantic_id: "q-sem-1",
  fact_base_ids: ["fb-1"],
  language: "pt-BR",
  type: "debut_year",
  theme: "kpop",
  play_mode: "standard",
  challenge_rating: "medium",
  base_points: 100,
  hint_cost: 20,
  clues_available: [
    {
      id: "clue-1",
      type: "decade",
      text: "O grupo estreou na década de 2010.",
      fact_base_ids: ["fb-1"],
      evidence: sampleEvidence,
    },
  ],
  clues_shown: [],
  group_ids: ["Q21461452"],
  prompt: "Qual grupo feminino sul-coreano foi formado pela JYP Entertainment em 2015?",
  options: sampleOptions,
  answer_option_id: "opt-1",
  explanation: "TWICE foi formado pela JYP Entertainment através do reality show Sixteen em 2015.",
  reference_date: "2026-01-01",
  evidence: sampleEvidence,
  media: sampleMedia,
};

const sampleResults: QuestionResult[] = [
  {
    question: sampleQuestion,
    selectedOptionId: "opt-1",
    isCorrect: true,
    cluesUsedCount: 0,
  },
  {
    question: {
      ...sampleQuestion,
      id: "q-2",
      prompt: "Qual grupo lançou a música DDU-DU DDU-DU?",
      answer_option_id: "opt-2",
      evidence: sampleEvidence,
    },
    selectedOptionId: "opt-3",
    isCorrect: false,
    cluesUsedCount: 1,
  },
];

describe("Automated accessibility audits with axe-core", () => {
  beforeAll(() => {
    if (typeof HTMLCanvasElement !== "undefined") {
      HTMLCanvasElement.prototype.getContext = () => null;
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("validates GameSetup screen with mode selection and timer", async () => {
    const { container } = render(
      <GameSetup
        playMode="standard"
        onSelectMode={vi.fn()}
        theme="history"
        onSelectTheme={vi.fn()}
        timerEnabled={true}
        onTimerChange={vi.fn()}
        onStart={vi.fn()}
        isReady={true}
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates GameCollection theme selector", async () => {
    const { container } = render(
      <GameCollection
        selectedTheme="history"
        onSelectTheme={vi.fn()}
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates question in progress with QuestionCard, ProgressHeader, HintTray, and LicensedMedia", async () => {
    const { container } = render(
      <section id="quiz" class="quiz-card" aria-labelledby="question-heading">
        <ProgressHeader
          currentIndex={0}
          totalQuestions={10}
          score={0}
          secondsLeft={25}
          timerVisible={true}
          messages={ptMessages}
        />
        <QuestionCard
          prompt={sampleQuestion.prompt}
          options={sampleQuestion.options}
          selectedOptionId="opt-1"
          onSelectOption={vi.fn()}
          answered={false}
          correctOptionId={sampleQuestion.answer_option_id}
          onSubmit={vi.fn()}
          submitLabel={ptMessages.check}
          legendLabel={ptMessages.chooseAnswer}
        >
          <LicensedMedia
            media={sampleQuestion.media}
            isAnswered={false}
            messages={ptMessages}
          />
          <HintTray
            playMode="standard"
            cluesAvailable={sampleQuestion.clues_available}
            cluesShown={[]}
            revealedClues={[]}
            hintCost={sampleQuestion.hint_cost}
            answered={false}
            onRevealClue={vi.fn()}
            messages={ptMessages}
          />
        </QuestionCard>
      </section>
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates question with revealed clue", async () => {
    const { container } = render(
      <section id="quiz" class="quiz-card" aria-labelledby="question-heading">
        <ProgressHeader
          currentIndex={0}
          totalQuestions={10}
          score={0}
          secondsLeft={18}
          timerVisible={true}
          messages={ptMessages}
        />
        <QuestionCard
          prompt={sampleQuestion.prompt}
          options={sampleQuestion.options}
          selectedOptionId={null}
          onSelectOption={vi.fn()}
          answered={false}
          correctOptionId={sampleQuestion.answer_option_id}
          onSubmit={vi.fn()}
          submitLabel={ptMessages.check}
          legendLabel={ptMessages.chooseAnswer}
        >
          <LicensedMedia
            media={sampleQuestion.media}
            isAnswered={false}
            messages={ptMessages}
          />
          <HintTray
            playMode="standard"
            cluesAvailable={sampleQuestion.clues_available}
            cluesShown={[sampleQuestion.clues_available[0]!.id]}
            revealedClues={[sampleQuestion.clues_available[0]!.id]}
            hintCost={sampleQuestion.hint_cost}
            answered={false}
            onRevealClue={vi.fn()}
            messages={ptMessages}
          />
        </QuestionCard>
      </section>
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates correct answer feedback", async () => {
    const { container } = render(
      <AnswerFeedback
        isCorrect={true}
        timedOut={false}
        correctOption={sampleOptions[0] ?? null}
        explanation={sampleQuestion.explanation}
        evidence={sampleQuestion.evidence}
        messages={ptMessages}
        isLastQuestion={false}
        onAdvance={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates incorrect answer feedback", async () => {
    const { container } = render(
      <AnswerFeedback
        isCorrect={false}
        timedOut={false}
        correctOption={sampleOptions[0] ?? null}
        explanation={sampleQuestion.explanation}
        evidence={sampleQuestion.evidence}
        messages={ptMessages}
        isLastQuestion={false}
        onAdvance={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates timed out answer feedback", async () => {
    const { container } = render(
      <AnswerFeedback
        isCorrect={false}
        timedOut={true}
        correctOption={sampleOptions[0] ?? null}
        explanation={sampleQuestion.explanation}
        evidence={sampleQuestion.evidence}
        messages={ptMessages}
        isLastQuestion={true}
        onAdvance={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates final result screen with ScoreSummary, ShareResult, and ReviewAnswers", async () => {
    const { container } = render(
      <QuizResult
        score={100}
        messages={ptMessages}
        onRestart={vi.fn()}
        totalQuestions={2}
        correctCount={1}
        elapsedSeconds={23}
        cluesUsedCount={1}
        playMode="standard"
        history={sampleResults}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates standalone ScoreSummary, ShareResult, and ReviewAnswers components", async () => {
    const { container } = render(
      <div>
        <ScoreSummary
          correctCount={1}
          totalQuestions={2}
          score={100}
          elapsedSeconds={23}
          cluesUsedCount={1}
          messages={ptMessages}
        />
        <ShareResult
          correctCount={1}
          totalQuestions={2}
          results={[true, false]}
          playMode="standard"
          cluesUsedCount={1}
          elapsedSeconds={23}
          messages={ptMessages}
        />
        <ReviewAnswers items={sampleResults} messages={ptMessages} />
      </div>
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates fallback state when media is unavailable", async () => {
    const invalidMedia = {
      ...sampleMedia,
      asset_url: "",
    };

    const { container } = render(
      <section id="quiz" class="quiz-card" aria-labelledby="question-heading">
        <QuestionCard
          prompt={sampleQuestion.prompt}
          options={sampleQuestion.options}
          selectedOptionId={null}
          onSelectOption={vi.fn()}
          answered={false}
          correctOptionId={sampleQuestion.answer_option_id}
          onSubmit={vi.fn()}
          submitLabel={ptMessages.check}
          legendLabel={ptMessages.chooseAnswer}
        >
          <LicensedMedia
            media={invalidMedia}
            isAnswered={false}
            messages={ptMessages}
          />
        </QuestionCard>
      </section>
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates QuizState in loading state", async () => {
    const { container } = render(
      <QuizState
        message={ptMessages.loading}
        busy={true}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates QuizState in integrity error state with reload action", async () => {
    const { container } = render(
      <QuizState
        message={ptMessages.errorDatasetIntegrity}
        actionLabel={ptMessages.reload}
        onAction={() => {}}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates QuizRound aggregator component", async () => {
    const { container } = render(
      <QuizRound
        question={sampleQuestion}
        playMode="standard"
        selectedId="opt-1"
        answered={false}
        onSelectOption={vi.fn()}
        onSubmit={vi.fn()}
        onRevealClue={vi.fn()}
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates QuizRound aggregator component when answered", async () => {
    const { container } = render(
      <QuizRound
        question={sampleQuestion}
        playMode="standard"
        selectedId="opt-1"
        answered={true}
        onSelectOption={vi.fn()}
        onSubmit={vi.fn()}
        onRevealClue={vi.fn()}
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
