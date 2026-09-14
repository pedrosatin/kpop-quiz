import { useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { isQuizSession, type Locale, type QuizSession } from "../../lib/quiz-types";
import { loadQuizSession, QuizArtifactError } from "../../data/session-loader";

type Status = "loading" | "ready" | "missing" | "invalid";

export function Quiz({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<QuizSession | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [score, setScore] = useState(0);
  const [complete, setComplete] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const answerLockedRef = useRef(false);
  const focusQuestionRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const load = () => {
    const request = ++loadRequestRef.current;
    setStatus("loading");
    loadQuizSession(locale)
      .then((value) => {
        if (request !== loadRequestRef.current) return;
        if (!isQuizSession(value)) throw new Error("Invalid quiz session");
        stopTimer();
        setSession(value);
        setQuestionIndex(0);
        setSelectedId(null);
        setAnswered(false);
        setTimedOut(false);
        setScore(0);
        setComplete(false);
        answerLockedRef.current = false;
        setSecondsLeft(value.config.timer_seconds ?? 0);
        setStatus("ready");
      })
      .catch((error) => {
        if (request === loadRequestRef.current) {
          setStatus(error instanceof QuizArtifactError ? error.kind : "invalid");
        }
      });
  };

  useEffect(() => {
    load();
    return () => {
      loadRequestRef.current += 1;
      stopTimer();
    };
  }, [locale]);

  const question = session?.questions[questionIndex];
  const timerSeconds = session?.config.timer_seconds ?? null;

  useEffect(() => {
    if (!question || answered || complete || timerSeconds === null) return;
    if (secondsLeft <= 0) {
      answerLockedRef.current = true;
      setTimedOut(true);
      setAnswered(true);
      return;
    }
    timerRef.current = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return stopTimer;
  }, [answered, complete, question, secondsLeft, timerSeconds]);

  useEffect(() => {
    if (answered) feedbackRef.current?.focus();
  }, [answered]);

  useEffect(() => {
    if (complete) {
      resultHeadingRef.current?.focus();
    } else if (focusQuestionRef.current && status === "ready") {
      headingRef.current?.focus();
      focusQuestionRef.current = false;
    }
  }, [complete, questionIndex, status]);

  const submit = () => {
    if (!question || !selectedId || answerLockedRef.current) return;
    answerLockedRef.current = true;
    stopTimer();
    if (selectedId === question.answer_option_id) setScore((value) => value + 1);
    setAnswered(true);
  };

  const advance = () => {
    if (!session) return;
    if (questionIndex === session.questions.length - 1) {
      setComplete(true);
      return;
    }
    answerLockedRef.current = false;
    focusQuestionRef.current = true;
    setQuestionIndex((value) => value + 1);
    setSelectedId(null);
    setAnswered(false);
    setTimedOut(false);
    setSecondsLeft(timerSeconds ?? 0);
  };

  const restart = () => {
    setQuestionIndex(0);
    setSelectedId(null);
    setAnswered(false);
    setTimedOut(false);
    setScore(0);
    setComplete(false);
    setSecondsLeft(timerSeconds ?? 0);
    answerLockedRef.current = false;
    focusQuestionRef.current = true;
  };

  if (status === "loading") {
    return <QuizState label={messages.loading} busy />;
  }
  if (status === "missing" || status === "invalid") {
    const label = status === "missing" ? messages.artifactMissing : messages.artifactInvalid;
    return <QuizState label={label} action={messages.retry} onAction={load} />;
  }
  if (!session || !question) {
    return <QuizState label={messages.empty} />;
  }
  if (complete) {
    return (
      <section id="quiz" class="quiz-card result" aria-labelledby="result-heading">
        <p class="kicker">{messages.score}</p>
        <h2 id="result-heading" ref={resultHeadingRef} tabIndex={-1}>{messages.resultTitle}</h2>
        <p class="result-score"><strong>{score}</strong><span>/ {session.questions.length}</span></p>
        <p>{messages.resultText(score, session.questions.length)}</p>
        <button class="primary-action" type="button" onClick={restart}>{messages.restart}</button>
      </section>
    );
  }

  const correctOption = question.options.find((option) => option.id === question.answer_option_id);
  const isCorrect = selectedId === question.answer_option_id;
  const progress = ((questionIndex + 1) / session.questions.length) * 100;

  return (
    <section id="quiz" class="quiz-card" aria-labelledby="question-heading">
      <div class="quiz-meta">
        <p>{messages.questionCounter(questionIndex + 1, session.questions.length)}</p>
        <p>{messages.score}: <strong>{score}</strong></p>
        {timerSeconds !== null && <p role="timer">{messages.time}: <strong>{secondsLeft}{messages.seconds}</strong></p>}
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={session.questions.length} aria-valuenow={questionIndex + 1} aria-label={messages.questionCounter(questionIndex + 1, session.questions.length)}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <h2 id="question-heading" ref={headingRef} tabIndex={-1}>{question.prompt}</h2>
      <fieldset class="options" disabled={answered}>
        <legend class="visually-hidden">{messages.chooseAnswer}</legend>
        {question.options.map((option, index) => {
          const state = answered
            ? option.id === question.answer_option_id ? "correct" : option.id === selectedId ? "incorrect" : ""
            : "";
          return (
            <label class={`option ${state}`} key={option.id}>
              <input type="radio" name="answer" value={option.id} checked={selectedId === option.id} onChange={() => setSelectedId(option.id)} />
              <span class="option-key" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
              <span>{option.label}</span>
            </label>
          );
        })}
      </fieldset>
      {!answered ? (
        <button class="primary-action" type="button" disabled={!selectedId} onClick={submit}>{messages.check}</button>
      ) : (
        <div class="feedback" ref={feedbackRef} tabIndex={-1} role="status">
          <p class={`feedback-title ${isCorrect && !timedOut ? "success" : "failure"}`}>
            {timedOut ? messages.timedOut : isCorrect ? messages.correct : messages.incorrect}
          </p>
          {!isCorrect && <p>{messages.answerWas}: <strong>{correctOption?.label}</strong></p>}
          <p>{question.explanation}</p>
          <details>
            <summary>{messages.evidence}</summary>
            {question.evidence.map((evidence) => (
              <p key={`${evidence.source_key}-${evidence.revision_id}`}>
                {sourceLabel(evidence.source_key)}, {messages.revision} {evidence.revision_id}. <a href={evidence.source_url} target="_blank" rel="noreferrer">{messages.openSource}<span class="visually-hidden"> ({sourceLabel(evidence.source_key)})</span></a>
              </p>
            ))}
          </details>
          <button class="primary-action" type="button" onClick={advance}>
            {questionIndex === session.questions.length - 1 ? messages.finish : messages.next}
          </button>
        </div>
      )}
    </section>
  );
}

function sourceLabel(sourceKey: string): string {
  if (sourceKey.startsWith("domain:")) return sourceKey.slice("domain:".length);
  if (sourceKey.startsWith("wikipedia:")) return `Wikipedia (${sourceKey.slice("wikipedia:".length)})`;
  return sourceKey;
}

function QuizState({ label, busy = false, action, onAction }: { label: string; busy?: boolean; action?: string; onAction?: () => void }) {
  return (
    <section id="quiz" class="quiz-card state" aria-live="polite" aria-busy={busy}>
      {busy && <span class="loader" aria-hidden="true" />}
      <p>{label}</p>
      {action && <button class="primary-action" type="button" onClick={onAction}>{action}</button>}
    </section>
  );
}
