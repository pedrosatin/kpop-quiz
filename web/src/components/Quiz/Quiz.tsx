import { useGameAnalytics } from "../../lib/game-analytics";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../../lib/quiz-types";
import { loadQuizSessionWithAvailability, QuizArtifactError } from "../../data/session-loader";
import { CatalogArtifactError, loadQuizCatalog } from "../../data/catalog-loader";
import {
  CatalogSelectionError,
  catalogAvailableDecades,
  selectCatalogRound,
} from "../../data/catalog-session";
import { GameSetup } from "../GameSetup/GameSetup";
import { QuizRound } from "./QuizRound";
import { groupEvidence } from "./AnswerFeedback";
import { QuizState } from "./QuizState";
import { QuizResult } from "./QuizResult";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import {
  buildQuizProgressSave,
  checkQuizProgressCompatibility,
  clearQuizProgress,
  expandHistory,
  loadQuizProgressSave,
  loadStoredPreferences,
  saveQuizProgress,
  saveStoredPlayMode,
  saveStoredTimerEnabled,
  type QuizProgressSave,
} from "./storage";
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
/** UI notice for the next replay: catalog pool of exactly ten, or legacy fallback. */
type ReplayNotice = "ok" | "repeats" | "legacy-repeats" | null;
type ResumeNotice = "incompatible" | "invalid" | "storage-unavailable" | null;

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
  const [replayStatus, setReplayStatus] = useState<ReplayNotice>(null);
  const [resumeNotice, setResumeNotice] = useState<ResumeNotice>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [restoredVisit, setRestoredVisit] = useState(false);

  const analytics = useGameAnalytics(
    { game: "quiz", locale, mode: playMode },
    state === "results",
    restoredVisit,
  );

  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const answerLockedRef = useRef(false);
  const focusQuestionRef = useRef(false);
  const loadRequestRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const recordedMatchRef = useRef<string | null>(null);
  const confirmGiveUpOpenRef = useRef(false);
  const gaveUpRef = useRef(false);
  const persistReadyRef = useRef(false);
  const question = session?.questions[questionIndex];
  const timerSeconds = timerEnabled ? 20 : session?.config.timer_seconds ?? null;
  const decadeKey = decades.join(",");
  const requestKey = `${locale}|${playMode}|${theme}|${decadeKey}`;

  const closeGiveUpConfirm = useCallback(() => {
    confirmGiveUpOpenRef.current = false;
    setConfirmGiveUpOpen(false);
  }, []);

  const markStorageUnavailable = useCallback(() => {
    setResumeNotice("storage-unavailable");
  }, []);

  const persistProgress = useCallback((
    machineState: "question.ready" | "question.answered" | "results",
    overrides: Partial<{
      session: QuizSession;
      sessionSource: SessionSource;
      questionIndex: number;
      selectedId: string | null;
      timedOut: boolean;
      score: number;
      revealedClues: string[];
      history: QuestionResult[];
      questionDeadlineMs: number | null;
      startedAtMs: number;
      elapsedSeconds: number;
      gaveUp: boolean;
      replayNotice: ReplayNotice;
      timerEnabled: boolean;
    }> = {},
  ) => {
    if (!persistReadyRef.current) return;
    const activeSession = overrides.session ?? session;
    if (!activeSession) return;
    const startedAt = overrides.startedAtMs ?? startTimeRef.current;
    if (startedAt === null) return;
    const payload = buildQuizProgressSave({
      session: activeSession,
      sessionSource: overrides.sessionSource ?? sessionSource,
      locale,
      playMode,
      theme,
      decades,
      timerEnabled: overrides.timerEnabled ?? timerEnabled,
      machineState,
      questionIndex: overrides.questionIndex ?? questionIndex,
      selectedId: overrides.selectedId ?? selectedId,
      timedOut: overrides.timedOut ?? timedOut,
      score: overrides.score ?? score,
      revealedClues: overrides.revealedClues ?? revealedClues,
      history: overrides.history ?? history,
      questionDeadlineMs: overrides.questionDeadlineMs ?? (machineState === "question.ready" ? deadlineMs : null),
      startedAtMs: startedAt,
      elapsedSeconds: overrides.elapsedSeconds ?? elapsedSeconds,
      gaveUp: overrides.gaveUp ?? gaveUpRef.current,
      replayNotice: overrides.replayNotice ?? replayStatus,
    });
    if (saveQuizProgress(payload) === "unavailable") markStorageUnavailable();
  }, [
    session, sessionSource, locale, playMode, theme, decades, timerEnabled,
    questionIndex, selectedId, timedOut, score, revealedClues, history,
    deadlineMs, elapsedSeconds, replayStatus, markStorageUnavailable,
  ]);

  const { secondsLeft, stopTimer } = useQuizTimer({
    active: state === "question.ready" && Boolean(question),
    deadlineMs: state === "question.ready" ? deadlineMs : null,
    onExpire: () => {
      // Timeout applies the normal rule once and drops any pending give-up confirm.
      closeGiveUpConfirm();
      answerLockedRef.current = true;
      setTimedOut(true);
      setDeadlineMs(null);
      const nextHistory = question
        ? [...history, { question, selectedOptionId: null, isCorrect: false, cluesUsedCount: revealedClues.length }]
        : history;
      let nextElapsed = elapsedSeconds;
      if (questionIndex === (session?.questions.length ?? 0) - 1 && startTimeRef.current) {
        nextElapsed = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
        setElapsedSeconds(nextElapsed);
      }
      setHistory(nextHistory);
      setState("question.answered");
      persistProgress("question.answered", {
        timedOut: true,
        selectedId: null,
        history: nextHistory,
        questionDeadlineMs: null,
        elapsedSeconds: nextElapsed,
      });
    },
  });

  const resetRound = (count: number, nextState: QuizMachineState, nextDeadline: number | null) => {
    analytics.reset();
    gaveUpRef.current = false;
    persistReadyRef.current = false;
    setRestoredVisit(false);
    setQuestionIndex(0);
    setSelectedId(null);
    setTimedOut(false);
    setScore(0);
    setRevealedClues([]);
    setHistory([]);
    setElapsedSeconds(0);
    answerLockedRef.current = false;
    setDeadlineMs(nextDeadline);
    setConfirmGiveUpOpen(false);
    confirmGiveUpOpenRef.current = false;
    setState(count > 0 ? nextState : "empty");
  };

  const applyRestoredSave = (
    save: QuizProgressSave,
    available: Exclude<QuizDecadeSelection[number], null>[],
    source: SessionSource,
  ) => {
    const expanded = expandHistory(save.history, save.session);
    if (!expanded) {
      clearQuizProgress();
      setResumeNotice("invalid");
      return false;
    }
    stopTimer();
    closeGiveUpConfirm();
    setSession(save.session);
    setSessionSource(source);
    setReplayStatus(save.replay_notice);
    setAvailableDecades(available);
    setLoadedRequestKey(`${locale}|${save.play_mode}|${save.theme}|${save.decades.join(",")}`);
    setTimerEnabled(save.timer_enabled);
    setQuestionIndex(Math.min(save.question_index, save.session.questions.length - 1));
    setSelectedId(save.selected_id);
    setTimedOut(save.timed_out);
    setScore(save.score);
    setRevealedClues(save.revealed_clues);
    setHistory(expanded);
    setElapsedSeconds(save.elapsed_seconds);
    startTimeRef.current = save.started_at_ms;
    gaveUpRef.current = save.gave_up;
    recordedMatchRef.current = null;
    answerLockedRef.current = save.machine_state !== "question.ready";
    setRestoredVisit(true);
    focusQuestionRef.current = false;
    persistReadyRef.current = true;

    if (save.machine_state === "question.ready") {
      setDeadlineMs(save.question_deadline_ms);
      setState("question.ready");
    } else if (save.machine_state === "question.answered") {
      setDeadlineMs(null);
      setState("question.answered");
    } else {
      setDeadlineMs(null);
      setState("results");
    }
    return true;
  };

  const applyRound = (
    value: QuizSession,
    available: Exclude<QuizDecadeSelection[number], null>[],
    loadedDecades: QuizDecadeSelection,
    source: SessionSource,
    status: ReplayNotice,
    nextState: QuizMachineState = "setup",
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
    const nextDeadline = nextState === "question.ready" && timerSeconds !== null
      ? Date.now() + timerSeconds * 1000
      : null;
    resetRound(value.questions.length, nextState, nextDeadline);
    if (nextState === "question.ready") {
      persistReadyRef.current = true;
    }
  };

  const tryResumePublished = (
    value: QuizSession,
    available: Exclude<QuizDecadeSelection[number], null>[],
    loadedDecades: QuizDecadeSelection,
    source: SessionSource,
    status: ReplayNotice,
  ): boolean => {
    const loaded = loadQuizProgressSave();
    if (loaded.status === "unavailable") {
      setResumeNotice("storage-unavailable");
      applyRound(value, available, loadedDecades, source, status);
      return true;
    }
    if (loaded.status === "missing") {
      applyRound(value, available, loadedDecades, source, status);
      return true;
    }
    if (loaded.status === "invalid") {
      clearQuizProgress();
      setResumeNotice("invalid");
      applyRound(value, available, loadedDecades, source, status);
      return true;
    }
    const compat = checkQuizProgressCompatibility(loaded.save, {
      locale,
      playMode,
      theme,
      decades: loadedDecades,
      session: value,
      sessionSource: source,
    });
    if (compat === "ok") {
      setResumeNotice(null);
      return applyRestoredSave(loaded.save, available, source);
    }
    clearQuizProgress();
    setResumeNotice(compat === "invalid" ? "invalid" : "incompatible");
    applyRound(value, available, loadedDecades, source, status);
    return true;
  };

  const isCatalogMissing = (error: unknown) =>
    (error instanceof CatalogSelectionError && error.kind === "missing")
    || (error instanceof CatalogArtifactError && error.kind === "missing");

  const loadPublished = (
    request: number,
    status: ReplayNotice = null,
    nextState: QuizMachineState = "setup",
    skipResume = false,
  ) =>
    loadQuizSessionWithAvailability(locale, playMode, theme, undefined, decades)
      .then(({ session: value, availableDecades: available, decades: loadedDecades }) => {
        if (request !== loadRequestRef.current) return;
        if (skipResume || nextState !== "setup") {
          applyRound(value, available, loadedDecades, "published", status, nextState);
          return;
        }
        tryResumePublished(value, available, loadedDecades, "published", status);
      });

  const tryResumeCatalog = async (request: number): Promise<boolean> => {
    const loaded = loadQuizProgressSave();
    if (loaded.status === "unavailable") {
      setResumeNotice("storage-unavailable");
      return false;
    }
    if (loaded.status === "missing") return false;
    if (loaded.status === "invalid") {
      clearQuizProgress();
      setResumeNotice("invalid");
      return false;
    }
    const save = loaded.save;
    if (save.session_source !== "catalog" || save.theme === "daily") return false;
    if (
      save.locale !== locale
      || save.play_mode !== playMode
      || save.theme !== theme
      || save.decades.join(",") !== decadeKey
    ) {
      // Different setup: leave the save for when the player returns to that config.
      return false;
    }
    try {
      const catalog = await loadQuizCatalog(locale, playMode);
      if (request !== loadRequestRef.current) return true;
      const compat = checkQuizProgressCompatibility(save, {
        locale,
        playMode,
        theme,
        decades,
        session: save.session,
        sessionSource: "catalog",
        catalogVersion: catalog.catalogVersion,
      });
      if (compat !== "ok") {
        clearQuizProgress();
        setResumeNotice(compat === "invalid" ? "invalid" : "incompatible");
        return false;
      }
      setResumeNotice(null);
      applyRestoredSave(save, catalogAvailableDecades(catalog), "catalog");
      return true;
    } catch (error) {
      if (request !== loadRequestRef.current) return true;
      if (isCatalogMissing(error)) {
        clearQuizProgress();
        setResumeNotice("incompatible");
        return false;
      }
      throw error;
    }
  };

  const load = () => {
    const request = ++loadRequestRef.current;
    if (state !== "setup") setState("loading");
    // Daily stays on the published session of the day. General quiz prefers the
    // validated catalog when published. Missing catalog → legacy published
    // sessions with an explicit repeat notice (operator decision 28/10/2026).
    // Corrupted catalog is a closed error with no unvalidated fallback.
    // Resume runs before drawing a new catalog set so the same selection returns.
    const pending = theme === "daily"
      ? loadPublished(request)
      : tryResumeCatalog(request).then((resumed) => {
        if (request !== loadRequestRef.current) return;
        if (resumed) return;
        return selectCatalogRound({ locale, playMode, decades, avoidPrevious: false })
          .then((round) => {
            if (request !== loadRequestRef.current) return;
            // Fresh catalog draw: drop a stale published save for this config.
            const existing = loadQuizProgressSave();
            if (existing.status === "ok") {
              clearQuizProgress();
              if (
                existing.save.locale === locale
                && existing.save.play_mode === playMode
                && existing.save.theme === theme
                && existing.save.decades.join(",") === decadeKey
              ) {
                setResumeNotice("incompatible");
              }
            }
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
            if (isCatalogMissing(error)) {
              return loadPublished(request, "legacy-repeats");
            }
            throw error;
          });
      });

    Promise.resolve(pending).catch((error) => {
      if (request !== loadRequestRef.current) return;
      if (error instanceof CatalogSelectionError) {
        // Missing already fell back above; treat a stray missing as invalid path noise.
        setState(error.kind === "unavailable" ? "unavailable" : "invalid");
        return;
      }
      if (error instanceof QuizArtifactError || error instanceof CatalogArtifactError) {
        setState(error.kind === "missing" ? "missing" : "invalid");
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

  useFocusOnChange(nextButtonRef, state === "question.answered" && !restoredVisit, questionIndex);
  useFocusOnChange(resultHeadingRef, state === "results" && !restoredVisit);

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

  // Persist pending selection while the question is still open (not an authorization).
  useEffect(() => {
    if (!persistReadyRef.current || state !== "question.ready" || !session) return;
    persistProgress("question.ready");
  }, [selectedId, state, session, persistProgress]);

  const start = () => {
    analytics.start();
    saveStoredPlayMode(playMode);
    saveStoredTimerEnabled(timerEnabled);
    updateUrlParams(playMode, theme, decades);
    focusQuestionRef.current = true;
    setRestoredVisit(false);
    startTimeRef.current = Date.now();
    const nextDeadline = timerSeconds !== null ? Date.now() + timerSeconds * 1000 : null;
    setDeadlineMs(nextDeadline);
    setState("question.ready");
    persistReadyRef.current = true;
    persistProgress("question.ready", {
      questionIndex: 0,
      selectedId: null,
      timedOut: false,
      score: 0,
      revealedClues: [],
      history: [],
      questionDeadlineMs: nextDeadline,
      startedAtMs: startTimeRef.current,
      elapsedSeconds: 0,
      gaveUp: false,
    });
  };

  const submit = () => {
    if (!question || !selectedId || answerLockedRef.current) return;
    answerLockedRef.current = true;
    setDeadlineMs(null);
    const isCorrect = selectedId === question.answer_option_id;
    const nextScore = isCorrect ? score + computeAwardedPoints(question, revealedClues) : score;
    if (isCorrect) setScore(nextScore);
    const nextHistory = [
      ...history,
      { question, selectedOptionId: selectedId, isCorrect, cluesUsedCount: revealedClues.length },
    ];
    let nextElapsed = elapsedSeconds;
    if (questionIndex === (session?.questions.length ?? 0) - 1 && startTimeRef.current) {
      nextElapsed = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
      setElapsedSeconds(nextElapsed);
    }
    setHistory(nextHistory);
    setState("question.answered");
    persistProgress("question.answered", {
      score: nextScore,
      history: nextHistory,
      questionDeadlineMs: null,
      elapsedSeconds: nextElapsed,
    });
  };

  const advance = () => {
    if (!session) return;
    if (questionIndex === session.questions.length - 1) {
      let nextElapsed = elapsedSeconds;
      if (elapsedSeconds === 0 && startTimeRef.current) {
        nextElapsed = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
        setElapsedSeconds(nextElapsed);
      }
      setState("results");
      persistProgress("results", {
        questionDeadlineMs: null,
        elapsedSeconds: nextElapsed,
      });
      return;
    }
    answerLockedRef.current = false;
    focusQuestionRef.current = true;
    setRestoredVisit(false);
    const nextIndex = questionIndex + 1;
    const nextDeadline = timerSeconds !== null ? Date.now() + timerSeconds * 1000 : null;
    setQuestionIndex(nextIndex);
    setSelectedId(null);
    setTimedOut(false);
    setRevealedClues([]);
    setDeadlineMs(nextDeadline);
    setState("question.ready");
    persistProgress("question.ready", {
      questionIndex: nextIndex,
      selectedId: null,
      timedOut: false,
      revealedClues: [],
      questionDeadlineMs: nextDeadline,
    });
  };

  const giveUp = () => {
    if (!session || state === "results" || gaveUpRef.current) return;
    gaveUpRef.current = true;
    setDeadlineMs(null);
    answerLockedRef.current = true;
    const answered = state === "question.answered";
    const start = questionIndex;
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
    const nextHistory = [...history, ...extra];
    let nextElapsed = elapsedSeconds;
    if (startTimeRef.current) {
      nextElapsed = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
      setElapsedSeconds(nextElapsed);
    }
    setHistory(nextHistory);
    setState("results");
    persistProgress("results", {
      history: nextHistory,
      questionDeadlineMs: null,
      elapsedSeconds: nextElapsed,
      gaveUp: true,
    });
  };

  const requestGiveUp = () => {
    confirmGiveUpOpenRef.current = true;
    setConfirmGiveUpOpen(true);
    // Open confirmation is never persisted as an authorized action.
  };

  const confirmGiveUp = () => {
    // A delayed click after timeout (or Escape) must not end the round.
    if (!confirmGiveUpOpenRef.current) return;
    closeGiveUpConfirm();
    giveUp();
  };

  const restart = () => {
    clearQuizProgress();
    setResumeNotice(null);
    // Daily keeps the published day session. Legacy published rounds (catalog
    // absent) reset the same ten with the legacy repeat notice. Catalog-backed
    // general quiz draws a new set when another combination exists; a missing
    // catalog on restart falls back to legacy with the same notice as load.
    if (theme === "daily") {
      startTimeRef.current = Date.now();
      recordedMatchRef.current = null;
      const nextDeadline = timerSeconds !== null ? Date.now() + timerSeconds * 1000 : null;
      resetRound(session?.questions.length ?? 0, "question.ready", nextDeadline);
      persistReadyRef.current = true;
      analytics.start();
      focusQuestionRef.current = true;
      persistProgress("question.ready", {
        questionIndex: 0,
        selectedId: null,
        timedOut: false,
        score: 0,
        revealedClues: [],
        history: [],
        questionDeadlineMs: nextDeadline,
        startedAtMs: startTimeRef.current,
        elapsedSeconds: 0,
        gaveUp: false,
      });
      return;
    }
    if (sessionSource !== "catalog") {
      setReplayStatus("legacy-repeats");
      startTimeRef.current = Date.now();
      recordedMatchRef.current = null;
      const nextDeadline = timerSeconds !== null ? Date.now() + timerSeconds * 1000 : null;
      resetRound(session?.questions.length ?? 0, "question.ready", nextDeadline);
      persistReadyRef.current = true;
      analytics.start();
      focusQuestionRef.current = true;
      persistProgress("question.ready", {
        questionIndex: 0,
        selectedId: null,
        timedOut: false,
        score: 0,
        revealedClues: [],
        history: [],
        questionDeadlineMs: nextDeadline,
        startedAtMs: startTimeRef.current,
        elapsedSeconds: 0,
        gaveUp: false,
        replayNotice: "legacy-repeats",
      });
      return;
    }
    const request = ++loadRequestRef.current;
    setState("loading");
    selectCatalogRound({ locale, playMode, decades, avoidPrevious: true })
      .then((round) => {
        if (request !== loadRequestRef.current) return;
        applyRound(
          round.session,
          round.availableDecades,
          decades,
          "catalog",
          round.status === "repeats" ? "repeats" : "ok",
          "question.ready",
        );
        startTimeRef.current = Date.now();
        recordedMatchRef.current = null;
        analytics.start();
        focusQuestionRef.current = true;
        persistReadyRef.current = true;
        persistProgress("question.ready", {
          session: round.session,
          sessionSource: "catalog",
          questionIndex: 0,
          selectedId: null,
          timedOut: false,
          score: 0,
          revealedClues: [],
          history: [],
          questionDeadlineMs: timerSeconds !== null ? Date.now() + timerSeconds * 1000 : null,
          startedAtMs: startTimeRef.current,
          elapsedSeconds: 0,
          gaveUp: false,
          replayNotice: round.status === "repeats" ? "repeats" : "ok",
        });
      })
      .catch((error) => {
        if (request !== loadRequestRef.current) return;
        if (error instanceof CatalogSelectionError && error.kind === "unavailable") {
          setState("unavailable");
          return;
        }
        if (isCatalogMissing(error)) {
          loadPublished(request, "legacy-repeats", "question.ready", true)
            .then(() => {
              if (request !== loadRequestRef.current) return;
              startTimeRef.current = Date.now();
              recordedMatchRef.current = null;
              analytics.start();
              focusQuestionRef.current = true;
              persistReadyRef.current = true;
            })
            .catch((publishedError) => {
              if (request !== loadRequestRef.current) return;
              if (publishedError instanceof QuizArtifactError) {
                setState(publishedError.kind);
                return;
              }
              setState("invalid");
            });
          return;
        }
        if (error instanceof CatalogSelectionError || error instanceof CatalogArtifactError) {
          setState("invalid");
          return;
        }
        setState("invalid");
      });
  };

  const replayNotice = replayStatus === "repeats"
    ? messages.quizReplayRepeats
    : replayStatus === "legacy-repeats"
      ? messages.quizReplayLegacyRepeats
      : undefined;

  const setupNotice = resumeNotice === "incompatible"
    ? messages.quizResumeIncompatible
    : resumeNotice === "invalid"
      ? messages.quizResumeInvalid
      : resumeNotice === "storage-unavailable"
        ? messages.quizStorageUnavailable
        : replayNotice;

  const revealClue = () => {
    if (!question) return;
    const next = question.clues_available.find((c) => !revealedClues.includes(c.id));
    if (!next) return;
    const nextClues = [...revealedClues, next.id];
    setRevealedClues(nextClues);
    persistProgress("question.ready", { revealedClues: nextClues });
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
        notice={setupNotice}
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
    const resultNotice = resumeNotice === "storage-unavailable"
      ? messages.quizStorageUnavailable
      : replayNotice;
    return (
      <QuizResult
        score={score} totalQuestions={session.questions.length} messages={messages} locale={locale}
        correctCount={history.filter((h) => h.isCorrect).length} elapsedSeconds={elapsedSeconds}
        cluesUsedCount={history.reduce((acc, h) => acc + h.cluesUsedCount, 0)}
        playMode={playMode} history={history}
        {...(restoredVisit ? {} : { headingRef: resultHeadingRef })}
        onRestart={restart}
        dailyDate={dailyDate} feedbackEligible={!gaveUpRef.current}
        {...(resultNotice ? { notice: resultNotice } : {})}
      />
    );
  }

  return (
    <>
      {resumeNotice === "storage-unavailable" && (
        <p class="game-actions-message" role="status" data-testid="quiz-storage-notice">
          {messages.quizStorageUnavailable}
        </p>
      )}
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
