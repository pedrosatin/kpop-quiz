import { useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../../lib/quiz-types";
import { loadQuizSession, QuizArtifactError } from "../../data/session-loader";
import { GameSetup } from "../GameSetup/GameSetup";
import { QuizRound } from "./QuizRound";
import { groupEvidence, type DisplayEvidence } from "./AnswerFeedback";
import { QuizState } from "./QuizState";
import { QuizResult } from "./QuizResult";
import { loadStoredPreferences, saveStoredPlayMode, saveStoredTimerEnabled } from "./storage";
import { computeAwardedPoints } from "./scoring";
import { useQuizTimer } from "./useQuizTimer";
import type { QuizMachineState } from "./types";

export { groupEvidence, type DisplayEvidence, type QuizMachineState };

export function Quiz({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const [state, setState] = useState<QuizMachineState>("loading");
  const [session, setSession] = useState<QuizSession | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>(() => {
    return loadStoredPreferences().playMode ?? "standard";
  });
  const [timerEnabled, setTimerEnabled] = useState<boolean>(() => {
    return loadStoredPreferences().timerEnabled ?? false;
  });
  const [revealedClues, setRevealedClues] = useState<string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [score, setScore] = useState(0);

  const feedbackRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const answerLockedRef = useRef(false);
  const focusQuestionRef = useRef(false);
  const loadRequestRef = useRef(0);

  const question = session?.questions[questionIndex];
  const timerSeconds = timerEnabled ? 20 : session?.config.timer_seconds ?? null;

  const { secondsLeft, setSecondsLeft, stopTimer } = useQuizTimer({
    active: state === "question.ready" && Boolean(question),
    initialSeconds: timerSeconds,
    onExpire: () => {
      answerLockedRef.current = true;
      setTimedOut(true);
      setState("question.answered");
    },
  });

  const resetRound = (count: number, seconds: number, nextState: QuizMachineState) => {
    setQuestionIndex(0);
    setSelectedId(null);
    setTimedOut(false);
    setScore(0);
    setRevealedClues([]);
    answerLockedRef.current = false;
    setSecondsLeft(seconds);
    setState(count > 0 ? nextState : "empty");
  };

  const load = () => {
    const request = ++loadRequestRef.current;
    if (state !== "setup") setState("loading");
    loadQuizSession(locale, playMode)
      .then((value) => {
        if (request !== loadRequestRef.current) return;
        if (!isQuizSession(value)) throw new Error("Invalid quiz session");
        stopTimer();
        setSession(value);
        resetRound(value.questions.length, value.config.timer_seconds ?? 0, "setup");
      })
      .catch((error) => {
        if (request === loadRequestRef.current) {
          setState(error instanceof QuizArtifactError ? error.kind : "invalid");
        }
      });
  };

  useEffect(() => {
    load();
    return () => { loadRequestRef.current += 1; stopTimer(); };
  }, [locale, playMode]);

  useEffect(() => {
    if (state === "question.answered") feedbackRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (state === "results") {
      resultHeadingRef.current?.focus();
    } else if (focusQuestionRef.current && (state === "question.ready" || state === "setup")) {
      headingRef.current?.focus();
      focusQuestionRef.current = false;
    }
  }, [questionIndex, state]);

  const start = () => {
    saveStoredPlayMode(playMode);
    saveStoredTimerEnabled(timerEnabled);
    focusQuestionRef.current = true;
    setSecondsLeft(timerSeconds ?? 0);
    setState("question.ready");
  };

  const submit = () => {
    if (!question || !selectedId || answerLockedRef.current) return;
    answerLockedRef.current = true;
    stopTimer();
    if (selectedId === question.answer_option_id) {
      setScore((val) => val + computeAwardedPoints(question, revealedClues));
    }
    setState("question.answered");
  };

  const advance = () => {
    if (!session) return;
    if (questionIndex === session.questions.length - 1) {
      setState("results");
      return;
    }
    answerLockedRef.current = false;
    focusQuestionRef.current = true;
    setQuestionIndex((val) => val + 1);
    setSelectedId(null);
    setTimedOut(false);
    setRevealedClues([]);
    setSecondsLeft(timerSeconds ?? 0);
    setState("question.ready");
  };

  const restart = () => {
    resetRound(session?.questions.length ?? 0, timerSeconds ?? 0, "question.ready");
    focusQuestionRef.current = true;
  };

  const revealClue = () => {
    if (!question) return;
    const next = question.clues_available.find((c) => !revealedClues.includes(c.id));
    if (next) setRevealedClues((val) => [...val, next.id]);
  };

  if (state === "loading") return <QuizState label={messages.loading} busy />;
  if (state === "missing" || state === "invalid") {
    return <QuizState label={state === "missing" ? messages.artifactMissing : messages.artifactInvalid} action={messages.retry} onAction={load} />;
  }
  if (state === "empty" || !session || !question) return <QuizState label={messages.empty} />;
  if (state === "setup") {
    return (
      <GameSetup
        playMode={playMode}
        onSelectMode={(mode) => { setPlayMode(mode); saveStoredPlayMode(mode); }}
        timerEnabled={timerEnabled}
        onTimerChange={(enabled) => { setTimerEnabled(enabled); saveStoredTimerEnabled(enabled); }}
        onStart={start}
        isReady={session.config.play_mode === playMode}
        messages={messages}
      />
    );
  }
  if (state === "results") {
    return <QuizResult score={score} messages={messages} headingRef={resultHeadingRef} onRestart={restart} />;
  }

  return (
    <QuizRound
      session={session}
      question={question}
      questionIndex={questionIndex}
      score={score}
      secondsLeft={secondsLeft}
      timerVisible={timerSeconds !== null}
      selectedId={selectedId}
      onSelectOption={setSelectedId}
      answered={state === "question.answered"}
      timedOut={timedOut}
      revealedClues={revealedClues}
      playMode={playMode}
      headingRef={headingRef}
      feedbackRef={feedbackRef}
      onSubmit={submit}
      onAdvance={advance}
      onRevealClue={revealClue}
      messages={messages}
    />
  );
}
