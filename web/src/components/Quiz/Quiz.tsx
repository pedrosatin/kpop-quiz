import { useGameAnalytics } from "../../lib/game-analytics";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../../lib/quiz-types";
import { loadQuizSessionWithAvailability, QuizArtifactError } from "../../data/session-loader";
import { CatalogArtifactError } from "../../data/catalog-loader";
import {
  CatalogSelectionError,
  selectCatalogRound,
} from "../../data/catalog-session";
import { GameSetup } from "../GameSetup/GameSetup";
import { QuizRound } from "./QuizRound";
import { groupEvidence } from "./AnswerFeedback";
import { QuizState } from "./QuizState";
import { QuizResult } from "./QuizResult";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
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

type SessionSource = "catalog" | "published";

export { groupEvidence };

export function Quiz({ locale, initialAvailableDecades = [] }: {
  locale: Locale;
  /** Decades computed from the manifest at build time, so the server-rendered setup matches the loaded one. */
  initialAvailableDecades?: Exclude<QuizDecadeSelection[number], null>[];
}) {
  const messages = getMessages(locale);
  const [state, setState] = useState<QuizMachineState>("loading");
  const [session, setSession] = useState<QuizSession | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>(() => getInitialUrlParams().playMode);
  const [theme, setTheme] = useState<QuizTheme>(() => getInitialUrlParams().theme);
  const [decades, setDecades] = useState<QuizDecadeSelection>(() => getInitialUrlParams().decades);
  const [availableDecades, setAvailableDecades] = useState<Exclude<QuizDecadeSelection[number], null>[]>(initialAvailableDecades);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [timerEnabled, setTimerEnabled] = useState<boolean>(() => loadStoredPreferences().timerEnabled ?? false);
  const [revealedClues, setRevealedClues] = useState<string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<QuestionResult[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const [sessionSource, setSessionSource] = useState<SessionSource>("published");
  const [replayStatus, setReplayStatus] = useState<"ok" | "repeats" | null>(null);

  const analytics = useGameAnalytics({ game: "quiz", locale, mode: playMode }, state === "results");

  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const answerLockedRef = useRef(false);
  const focusQuestionRef = useRef(false);
  const loadRequestRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const recordedMatchRef = useRef<string | null>(null);
  const confirmGiveUpOpenRef = useRef(false);
  const question = session?.questions[questionIndex];
  const timerSeconds = timerEnabled ? 20 : session?.config.timer_seconds ?? null;
  const decadeKey = decades.join(",");
  const requestKey = `${locale}|${playMode}|${theme}|${decadeKey}`;

  const closeGiveUpConfirm = useCallback(() => {
    confirmGiveUpOpenRef.current = false;
    setConfirmGiveUpOpen(false);
  }, []);

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
      // Timeout applies the normal rule once and drops any pending give-up confirm.
      closeGiveUpConfirm();
      answerLockedRef.current = true;
      setTimedOut(true);
      recordAnswer(null, false);
      setState("question.answered");
    },
  });

  const resetRound = (count: number, seconds: number, nextState: QuizMachineState) => {
    analytics.reset();
    gaveUpRef.current = false;
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

  const applyRound = (
    value: QuizSession,
    available: Exclude<QuizDecadeSelection[number], null>[],
    loadedDecades: QuizDecadeSelection,
    source: SessionSource,
    status: "ok" | "repeats" | null,
  ) => {
    if (!isQuizSession(value)) throw new Error("Invalid quiz session");
    stopTimer();
    setSession(value);
    setSessionSource(source);
    setReplayStatus(status);
    setAvailableDecades(available);
    setLoadedRequestKey(`${locale}|${playMode}|${theme}|${loadedDecades.join(",")}`);
    if (loadedDecades.join(",") !== decades.join(",")) {
      setDecades(loadedDecades);
      updateUrlParams(playMode, loadedDecades.length ? "history" : theme, loadedDecades);
    }
    resetRound(value.questions.length, value.config.timer_seconds ?? 0, "setup");
  };

  const loadPublished = (request: number) =>
    loadQuizSessionWithAvailability(locale, playMode, theme, undefined, decades)
      .then(({ session: value, availableDecades: available, decades: loadedDecades }) => {
        if (request !== loadRequestRef.current) return;
        applyRound(value, available, loadedDecades, "published", null);
      });

  const load = () => {
    const request = ++loadRequestRef.current;
    if (state !== "setup") setState("loading");
    // Daily stays on the published session of the day. General quiz prefers the
    // validated catalog when published; a missing catalog keeps the legacy
    // sessions. A corrupted catalog is a closed error with no unvalidated fallback.
    const pending = theme === "daily"
      ? loadPublished(request)
      : selectCatalogRound({ locale, playMode, decades, avoidPrevious: false })
        .then((round) => {
          if (request !== loadRequestRef.current) return;
          applyRound(
            round.session,
            round.availableDecades,
            decades,
            "catalog",
            round.status === "repeats" ? "repeats" : "ok",
          );
        })
        .catch((error) => {
          if (request !== loadRequestRef.current) return Promise.resolve();
          if (error instanceof CatalogSelectionError && error.kind === "unavailable") {
            setSession(null);
            setSessionSource("catalog");
            setReplayStatus(null);
            setState("unavailable");
            return;
          }
          if (
            (error instanceof CatalogSelectionError && error.kind === "missing")
            || (error instanceof CatalogArtifactError && error.kind === "missing")
          ) {
            return loadPublished(request);
          }
          throw error;
        });

    pending.catch((error) => {
      if (request !== loadRequestRef.current) return;
      if (error instanceof CatalogSelectionError) {
        setState(error.kind === "unavailable" ? "unavailable" : error.kind === "missing" ? "missing" : "invalid");
        return;
      }
      if (error instanceof QuizArtifactError || error instanceof CatalogArtifactError) {
        setState(error.kind);
        return;
      }
      setState("invalid");
    });
  };

  useEffect(() => setHydrated(true), []);

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
    analytics.start();
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

  const gaveUpRef = useRef(false);

  const giveUp = () => {
    if (!session || state === "results" || gaveUpRef.current) return;
    gaveUpRef.current = true;
    stopTimer();
    answerLockedRef.current = true;
    const answered = state === "question.answered";
    const start = questionIndex;
    setHistory((prev) => {
      const extra: QuestionResult[] = [];
      if (!answered && question) {
        extra.push({ question, selectedOptionId: null, isCorrect: false, cluesUsedCount: revealedClues.length });
      }
      // The current question is already in history when answered (submit
      // recorded it) or pushed above when not, so the loop always resumes
      // after it.
      for (let i = start + 1; i < session.questions.length; i++) {
        extra.push({ question: session.questions[i]!, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0 });
      }
      return [...prev, ...extra];
    });
    if (startTimeRef.current) {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000)));
    }
    setState("results");
  };

  const requestGiveUp = () => {
    confirmGiveUpOpenRef.current = true;
    setConfirmGiveUpOpen(true);
  };

  const confirmGiveUp = () => {
    // A delayed click after timeout (or Escape) must not end the round.
    if (!confirmGiveUpOpenRef.current) return;
    closeGiveUpConfirm();
    giveUp();
  };

  const restart = () => {
    // Daily and legacy published sessions keep the same ten questions.
    // Catalog-backed general quiz draws a new set, avoiding the previous one
    // when another combination exists.
    if (theme === "daily" || sessionSource !== "catalog") {
      startTimeRef.current = Date.now();
      recordedMatchRef.current = null;
      resetRound(session?.questions.length ?? 0, timerSeconds ?? 0, "question.ready");
      analytics.start();
      focusQuestionRef.current = true;
      return;
    }
    const request = ++loadRequestRef.current;
    setState("loading");
    selectCatalogRound({ locale, playMode, decades, avoidPrevious: true })
      .then((round) => {
        if (request !== loadRequestRef.current) return;
        if (!isQuizSession(round.session)) throw new Error("Invalid quiz session");
        stopTimer();
        setSession(round.session);
        setSessionSource("catalog");
        setReplayStatus(round.status === "repeats" ? "repeats" : "ok");
        setAvailableDecades(round.availableDecades);
        setLoadedRequestKey(`${locale}|${playMode}|${theme}|${decades.join(",")}`);
        startTimeRef.current = Date.now();
        recordedMatchRef.current = null;
        resetRound(round.session.questions.length, timerSeconds ?? 0, "question.ready");
        analytics.start();
        focusQuestionRef.current = true;
      })
      .catch((error) => {
        if (request !== loadRequestRef.current) return;
        if (error instanceof CatalogSelectionError && error.kind === "unavailable") {
          setState("unavailable");
          return;
        }
        if (error instanceof CatalogSelectionError || error instanceof CatalogArtifactError) {
          setState(error.kind === "missing" ? "missing" : "invalid");
          return;
        }
        setState("invalid");
      });
  };

  const revealClue = () => {
    if (!question) return;
    const next = question.clues_available.find((c) => !revealedClues.includes(c.id));
    if (next) setRevealedClues((val) => [...val, next.id]);
  };

  if (state === "missing" || state === "invalid") {
    return (
      <QuizState
        label={state === "missing" ? messages.artifactMissing : messages.artifactInvalid}
        action={messages.retry}
        onAction={load}
        wide
      />
    );
  }
  if (state === "unavailable") {
    return (
      <QuizState
        label={messages.quizReplayUnavailable}
        action={messages.retry}
        onAction={() => {
          if (decades.length) {
            setDecades([]);
            setTheme("history");
            updateUrlParams(playMode, "history", []);
            // Clearing filters changes decadeKey and reloads through the effect.
            return;
          }
          load();
        }}
        wide
      />
    );
  }
  // While the session loads, the setup is already on screen with Start
  // disabled: the server renders it, so the card keeps its final height and
  // the content below does not shift when the data arrives.
  // The server has no localStorage or URL, so its HTML marks the default mode,
  // theme and timer as selected. hydrate() reuses that DOM without patching
  // class attributes, so the default card would stay highlighted next to the
  // stored choice. Changing the key after the first effect remounts the setup
  // with client state; the layout is identical, so nothing shifts.
  if (state === "loading" || state === "setup") {
    return (
      <GameSetup key={hydrated ? "client" : "ssr"} busy={state === "loading"} busyLabel={messages.loading}
        playMode={playMode} theme={theme} decades={decades} availableDecades={availableDecades} timerEnabled={timerEnabled} messages={messages}
        notice={replayStatus === "repeats" ? messages.quizReplayRepeats : undefined}
        onSelectTheme={(t) => { setTheme(t); setDecades([]); updateUrlParams(playMode, t, []); }}
        onSelectDecades={(selected) => { setDecades(selected); setTheme("history"); updateUrlParams(playMode, "history", selected); }}
        onSelectMode={(mode) => { setPlayMode(mode); saveStoredPlayMode(mode); updateUrlParams(mode, theme, decades); }}
        onTimerChange={(enabled) => { setTimerEnabled(enabled); saveStoredTimerEnabled(enabled); }}
        onStart={start} isReady={state === "setup" && loadedRequestKey === requestKey && session?.config.play_mode === playMode}
      />
    );
  }
  if (state === "empty" || !session || !question) return <QuizState label={messages.empty} wide />;
  if (state === "results") {
    const dailyDate = theme === "daily" && session.config.seed?.startsWith("kpop-daily-")
      ? session.config.seed.replace("kpop-daily-", "")
      : theme === "daily" ? new Date().toISOString().slice(0, 10) : undefined;
    return (
      <QuizResult
        score={score} totalQuestions={session.questions.length} messages={messages} locale={locale}
        correctCount={history.filter((h) => h.isCorrect).length} elapsedSeconds={elapsedSeconds}
        cluesUsedCount={history.reduce((acc, h) => acc + h.cluesUsedCount, 0)}
        playMode={playMode} history={history} headingRef={resultHeadingRef} onRestart={restart}
        dailyDate={dailyDate} feedbackEligible={!gaveUpRef.current}
        notice={sessionSource === "catalog" && replayStatus === "repeats" ? messages.quizReplayRepeats : undefined}
      />
    );
  }

  return (
    <>
      <QuizRound
        session={session} question={question} questionIndex={questionIndex} score={score}
        secondsLeft={secondsLeft} timerVisible={timerSeconds !== null} selectedId={selectedId}
        onSelectOption={setSelectedId} answered={state === "question.answered"} timedOut={timedOut}
        revealedClues={revealedClues} playMode={playMode} headingRef={headingRef} actionRef={nextButtonRef}
        onSubmit={submit} onAdvance={advance} onGiveUp={requestGiveUp} onRevealClue={revealClue} messages={messages}
      />
      <ConfirmDialog
        isOpen={confirmGiveUpOpen}
        title={messages.giveUpConfirmTitle}
        body={messages.giveUpConfirmBody}
        confirmLabel={messages.giveUpConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={confirmGiveUp}
        onCancel={closeGiveUpConfirm}
      />
    </>
  );
}
