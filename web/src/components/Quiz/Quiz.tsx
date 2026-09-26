import { useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../../lib/quiz-types";
import { loadQuizSessionWithAvailability, QuizArtifactError } from "../../data/session-loader";
import { GameSetup } from "../GameSetup/GameSetup";
import { QuizRound } from "./QuizRound";
import { groupEvidence, type DisplayEvidence } from "./AnswerFeedback";
import { QuizState } from "./QuizState";
import { QuizResult } from "./QuizResult";
import { loadStoredPreferences, saveStoredPlayMode, saveStoredTimerEnabled } from "./storage";
import { computeAwardedPoints } from "./scoring";
import { useQuizTimer } from "./useQuizTimer";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { getInitialUrlParams, updateUrlParams, type QuizDecadeSelection, type QuizTheme } from "./url-params";
import type { QuestionResult, QuizMachineState } from "./types";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";

export { groupEvidence, type DisplayEvidence, type QuestionResult, type QuizMachineState };

export function Quiz({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const [state, setState] = useState<QuizMachineState>("loading");
  const [session, setSession] = useState<QuizSession | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>(() => getInitialUrlParams().playMode);
  const [theme, setTheme] = useState<QuizTheme>(() => getInitialUrlParams().theme);
  const [decades, setDecades] = useState<QuizDecadeSelection>(() => getInitialUrlParams().decades);
  const [availableDecades, setAvailableDecades] = useState<Exclude<QuizDecadeSelection[number], null>[]>([]);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [timerEnabled, setTimerEnabled] = useState<boolean>(() => loadStoredPreferences().timerEnabled ?? false);
  const [revealedClues, setRevealedClues] = useState<string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<QuestionResult[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const answerLockedRef = useRef(false);
  const focusQuestionRef = useRef(false);
  const loadRequestRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const recordedMatchRef = useRef<string | null>(null);
  const question = session?.questions[questionIndex];
  const timerSeconds = timerEnabled ? 20 : session?.config.timer_seconds ?? null;
  const decadeKey = decades.join(",");
  const requestKey = `${locale}|${playMode}|${theme}|${decadeKey}`;

  const recordAnswer = (selected: string | null, isCorrect: boolean) => {
    if (question) {
      setHistory((prev) => [...prev, { question, selectedOptionId: selected, isCorrect, cluesUsedCount: revealedClues.length }]);
    }
    if (questionIndex === (session?.questions.length ?? 0) - 1 && startTimeRef.current) {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000)));
    }
  };

  const { secondsLeft, setSecondsLeft, stopTimer } = useQuizTimer({
    active: state === "question.ready" && Boolean(question),
    initialSeconds: timerSeconds,
    onExpire: () => {
      answerLockedRef.current = true;
      setTimedOut(true);
      recordAnswer(null, false);
      setState("question.answered");
    },
  });

  const resetRound = (count: number, seconds: number, nextState: QuizMachineState) => {
    setQuestionIndex(0);
    setSelectedId(null);
    setTimedOut(false);
    setScore(0);
    setRevealedClues([]);
    setHistory([]);
    setElapsedSeconds(0);
    answerLockedRef.current = false;
    setSecondsLeft(seconds);
    setState(count > 0 ? nextState : "empty");
  };

  const load = () => {
    const request = ++loadRequestRef.current;
    if (state !== "setup") setState("loading");
    loadQuizSessionWithAvailability(locale, playMode, theme, undefined, decades)
      .then(({ session: value, availableDecades: available, decades: loadedDecades }) => {
        if (request !== loadRequestRef.current) return;
        if (!isQuizSession(value)) throw new Error("Invalid quiz session");
        stopTimer();
        setSession(value);
        setAvailableDecades(available);
        setLoadedRequestKey(`${locale}|${playMode}|${theme}|${loadedDecades.join(",")}`);
        if (loadedDecades.join(",") !== decades.join(",")) {
          setDecades(loadedDecades);
          updateUrlParams(playMode, loadedDecades.length ? "history" : theme, loadedDecades);
        }
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
  }, [locale, playMode, theme, decadeKey]);

  useFocusOnChange(nextButtonRef, state === "question.answered", questionIndex);
  useFocusOnChange(resultHeadingRef, state === "results");

  useEffect(() => {
    if (focusQuestionRef.current && (state === "question.ready" || state === "setup")) {
      headingRef.current?.focus();
      focusQuestionRef.current = false;
    }
  }, [questionIndex, state]);

  useEffect(() => {
    if (state === "results" && session) {
      const dailyDate = theme === "daily" && session.config.seed?.startsWith("kpop-daily-")
        ? session.config.seed.replace("kpop-daily-", "")
        : (theme === "daily" ? getTodayDateString() : undefined);
      const matchId = dailyDate ? `daily-${dailyDate}` : `session-${session.session_id || "default"}`;

      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("quiz", matchId)) {
        const correctCount = history.filter((h) => h.isCorrect).length;
        const total = session.questions.length || 10;
        const isWin = correctCount >= Math.ceil(total / 2);
        recordGameFinish("quiz", isWin, dailyDate || getTodayDateString());
        markGameMatchRecorded("quiz", matchId);
        recordedMatchRef.current = matchId;
      }
    }
  }, [state, session, history, theme]);

  const start = () => {
    saveStoredPlayMode(playMode);
    saveStoredTimerEnabled(timerEnabled);
    updateUrlParams(playMode, theme, decades);
    focusQuestionRef.current = true;
    startTimeRef.current = Date.now();
    setSecondsLeft(timerSeconds ?? 0);
    setState("question.ready");
  };

  const submit = () => {
    if (!question || !selectedId || answerLockedRef.current) return;
    answerLockedRef.current = true;
    stopTimer();
    const isCorrect = selectedId === question.answer_option_id;
    if (isCorrect) setScore((val) => val + computeAwardedPoints(question, revealedClues));
    recordAnswer(selectedId, isCorrect);
    setState("question.answered");
  };

  const advance = () => {
    if (!session) return;
    if (questionIndex === session.questions.length - 1) {
      if (elapsedSeconds === 0 && startTimeRef.current) {
        setElapsedSeconds(Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000)));
      }
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
    startTimeRef.current = Date.now();
    recordedMatchRef.current = null;
    resetRound(session?.questions.length ?? 0, timerSeconds ?? 0, "question.ready");
    focusQuestionRef.current = true;
  };

  const revealClue = () => {
    if (!question) return;
    const next = question.clues_available.find((c) => !revealedClues.includes(c.id));
    if (next) setRevealedClues((val) => [...val, next.id]);
  };

  if (state === "loading") return <QuizState label={messages.loading} busy wide />;
  if (state === "missing" || state === "invalid") return <QuizState label={state === "missing" ? messages.artifactMissing : messages.artifactInvalid} action={messages.retry} onAction={load} wide />;
  if (state === "empty" || !session || !question) return <QuizState label={messages.empty} wide />;
  if (state === "setup") {
    return (
      <GameSetup
        playMode={playMode} theme={theme} decades={decades} availableDecades={availableDecades} timerEnabled={timerEnabled} messages={messages}
        onSelectTheme={(t) => { setTheme(t); setDecades([]); updateUrlParams(playMode, t, []); }}
        onSelectDecades={(selected) => { setDecades(selected); setTheme("history"); updateUrlParams(playMode, "history", selected); }}
        onSelectMode={(mode) => { setPlayMode(mode); saveStoredPlayMode(mode); updateUrlParams(mode, theme, decades); }}
        onTimerChange={(enabled) => { setTimerEnabled(enabled); saveStoredTimerEnabled(enabled); }}
        onStart={start} isReady={loadedRequestKey === requestKey && session.config.play_mode === playMode}
      />
    );
  }
  if (state === "results") {
    const dailyDate = theme === "daily" && session.config.seed?.startsWith("kpop-daily-")
      ? session.config.seed.replace("kpop-daily-", "")
      : theme === "daily" ? new Date().toISOString().slice(0, 10) : undefined;
    return (
      <QuizResult
        score={score} totalQuestions={session.questions.length} messages={messages}
        correctCount={history.filter((h) => h.isCorrect).length} elapsedSeconds={elapsedSeconds}
        cluesUsedCount={history.reduce((acc, h) => acc + h.cluesUsedCount, 0)}
        playMode={playMode} history={history} headingRef={resultHeadingRef} onRestart={restart}
        dailyDate={dailyDate}
      />
    );
  }

  return (
    <QuizRound
      session={session} question={question} questionIndex={questionIndex} score={score}
      secondsLeft={secondsLeft} timerVisible={timerSeconds !== null} selectedId={selectedId}
      onSelectOption={setSelectedId} answered={state === "question.answered"} timedOut={timedOut}
      revealedClues={revealedClues} playMode={playMode} headingRef={headingRef} actionRef={nextButtonRef}
      onSubmit={submit} onAdvance={advance} onRevealClue={revealClue} messages={messages}
    />
  );
}
