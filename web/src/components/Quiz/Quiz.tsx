import { useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { isQuizSession, type Locale, type PlayMode, type QuizQuestion, type QuizSession } from "../../lib/quiz-types";
import { loadQuizSession, QuizArtifactError } from "../../data/session-loader";

type Status = "loading" | "ready" | "missing" | "invalid";

export function Quiz({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<QuizSession | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>("standard");
  const [started, setStarted] = useState(false);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [revealedClues, setRevealedClues] = useState<string[]>([]);
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
    if (status !== "ready") setStatus("loading");
    loadQuizSession(locale, playMode)
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
        setRevealedClues([]);
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
  }, [locale, playMode]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("kpop-quiz-play-mode");
      if (stored === "assisted" || stored === "standard" || stored === "expert") {
        setPlayMode(stored);
      }
    } catch {
      // Storage is optional; private browsing may deny access.
    }
  }, []);

  const question = session?.questions[questionIndex];
  const timerSeconds = timerEnabled ? 20 : session?.config.timer_seconds ?? null;

  useEffect(() => {
    if (!started || !question || answered || complete || timerSeconds === null) return;
    if (secondsLeft <= 0) {
      answerLockedRef.current = true;
      setTimedOut(true);
      setAnswered(true);
      return;
    }
    timerRef.current = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return stopTimer;
  }, [answered, complete, question, secondsLeft, started, timerSeconds]);

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
  }, [complete, questionIndex, started, status]);

  const submit = () => {
    if (!question || !selectedId || answerLockedRef.current) return;
    answerLockedRef.current = true;
    stopTimer();
    if (selectedId === question.answer_option_id) {
      const cost = revealedClues.filter((id) => !question.clues_shown.includes(id)).length * question.hint_cost;
      setScore((value) => value + Math.max(0, question.base_points - cost));
    }
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
    setRevealedClues([]);
    setSecondsLeft(timerSeconds ?? 0);
  };

  const restart = () => {
    setQuestionIndex(0);
    setSelectedId(null);
    setAnswered(false);
    setTimedOut(false);
    setScore(0);
    setComplete(false);
    setRevealedClues([]);
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
  if (!started) {
    const modes: PlayMode[] = ["assisted", "standard", "expert"];
    return (
      <section id="quiz" class="quiz-card setup" aria-labelledby="difficulty-heading">
        <p class="kicker">{messages.setupKicker}</p>
        <h2 id="difficulty-heading">{messages.chooseDifficulty}</h2>
        <fieldset class="difficulty-picker">
          <legend class="visually-hidden">{messages.chooseDifficulty}</legend>
          {modes.map((mode) => (
            <label class={`difficulty-option ${playMode === mode ? "selected" : ""}`} key={mode}>
              <input type="radio" name="play-mode" value={mode} checked={playMode === mode} onChange={() => setPlayMode(mode)} />
              <strong>{messages.difficultyName(mode)}</strong>
              <span>{messages.difficultyDescription(mode)}</span>
            </label>
          ))}
        </fieldset>
        <label class="timer-choice">
          <input type="checkbox" checked={timerEnabled} onChange={(event) => setTimerEnabled(event.currentTarget.checked)} />
          <span>{messages.enableTimer}</span>
        </label>
        <button class="primary-action" type="button" disabled={session.config.play_mode !== playMode} onClick={() => {
          try { window.localStorage.setItem("kpop-quiz-play-mode", playMode); } catch { /* optional */ }
          focusQuestionRef.current = true;
          setSecondsLeft(timerEnabled ? 20 : session.config.timer_seconds ?? 0);
          setStarted(true);
          window.queueMicrotask(() => headingRef.current?.focus());
        }}>{messages.start}</button>
      </section>
    );
  }
  if (complete) {
    return (
      <section id="quiz" class="quiz-card result" aria-labelledby="result-heading">
        <p class="kicker">{messages.score}</p>
        <h2 id="result-heading" ref={resultHeadingRef} tabIndex={-1}>{messages.resultTitle}</h2>
        <p class="result-score"><strong>{score}</strong><span> {messages.points}</span></p>
        <p>{messages.resultText(score)}</p>
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
      {[...new Set([...question.clues_shown, ...revealedClues])].map((id) => {
        const clue = question.clues_available.find((item) => item.id === id);
        return clue ? <p class="quiz-clue" id={`clue-${id}`} key={id} role="status" aria-live="polite"><strong>{messages.clue}:</strong> {clue.text}</p> : null;
      })}
      {playMode === "standard" && question.clues_available.length > 0 && (() => {
        const nextClue = question.clues_available.find((clue) => !revealedClues.includes(clue.id));
        return <button class="secondary-action" type="button" disabled={answered || !nextClue} aria-controls={question.clues_available.map((clue) => `clue-${clue.id}`).join(" ")} onClick={() => {
          if (nextClue) setRevealedClues((value) => [...value, nextClue.id]);
        }}>{nextClue ? messages.revealClue(question.hint_cost) : messages.clueRevealed}</button>;
      })()}
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
            {groupEvidence(question.evidence).map((evidence) => (
              <p key={`${evidence.source_url}-${evidence.revision_id}-${evidence.locator}`}>
                {evidence.project}, {messages.revision} {evidence.revision_id}.
                {evidence.declaredReference && <> {messages.declaredReference}: {evidence.declaredReference}.</>}
                {" "}<a href={evidence.source_url} target="_blank" rel="noreferrer">{messages.openRevision(evidence.project)}</a>
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

interface DisplayEvidence {
  source_url: string;
  revision_id: number;
  locator: string;
  project: "Wikidata" | "Wikipedia";
  declaredReference: string | null;
}

export function groupEvidence(evidenceItems: QuizQuestion["evidence"]): DisplayEvidence[] {
  const groups = new Map<string, DisplayEvidence>();
  for (const evidence of evidenceItems) {
    const key = `${evidence.source_url}\u0000${evidence.revision_id}\u0000${evidence.locator}`;
    if (groups.has(key)) continue;
    const wikidata = new URL(evidence.source_url).hostname === "www.wikidata.org";
    groups.set(key, {
      source_url: evidence.source_url,
      revision_id: evidence.revision_id,
      locator: evidence.locator,
      project: wikidata ? "Wikidata" : "Wikipedia",
      declaredReference: wikidata && evidence.source_key.startsWith("domain:")
        ? evidence.source_key.slice("domain:".length)
        : null,
    });
  }
  return [...groups.values()];
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
