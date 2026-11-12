import { useCallback, useRef, useState } from "preact/hooks";
import type { QuizSession } from "../../lib/quiz-types";
import type { QuestionResult, QuizMachineState, ReplayNotice, ResumeNotice, SessionSource } from "./types";

/** State and refs of the match in progress: machine state, answers, clock and give-up dialog. */
export function useQuizMatch() {
  const [state, setState] = useState<QuizMachineState>("loading");
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [revealedClues, setRevealedClues] = useState<string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<QuestionResult[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const [sessionSource, setSessionSource] = useState<SessionSource>("published");
  const [replayStatus, setReplayStatus] = useState<ReplayNotice>(null);
  const [resumeNotice, setResumeNotice] = useState<ResumeNotice>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [restoredVisit, setRestoredVisit] = useState(false);

  const answerLockedRef = useRef(false);
  const focusQuestionRef = useRef(false);
  /** Set when the player picks a saved round to continue; its question takes focus once restored. */
  const focusRestoredRef = useRef(false);
  const loadRequestRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const recordedMatchRef = useRef<string | null>(null);
  const confirmGiveUpOpenRef = useRef(false);
  const gaveUpRef = useRef(false);
  const persistReadyRef = useRef(false);

  const closeGiveUpConfirm = useCallback(() => {
    confirmGiveUpOpenRef.current = false;
    setConfirmGiveUpOpen(false);
  }, []);

  const markStorageUnavailable = useCallback(() => {
    setResumeNotice("storage-unavailable");
  }, []);

  return {
    state, setState,
    session, setSession,
    loadedRequestKey, setLoadedRequestKey,
    revealedClues, setRevealedClues,
    questionIndex, setQuestionIndex,
    selectedId, setSelectedId,
    timedOut, setTimedOut,
    score, setScore,
    history, setHistory,
    elapsedSeconds, setElapsedSeconds,
    confirmGiveUpOpen, setConfirmGiveUpOpen,
    sessionSource, setSessionSource,
    replayStatus, setReplayStatus,
    resumeNotice, setResumeNotice,
    deadlineMs, setDeadlineMs,
    restoredVisit, setRestoredVisit,
    answerLockedRef,
    focusQuestionRef,
    focusRestoredRef,
    loadRequestRef,
    startTimeRef,
    recordedMatchRef,
    confirmGiveUpOpenRef,
    gaveUpRef,
    persistReadyRef,
    closeGiveUpConfirm,
    markStorageUnavailable,
  };
}

export type QuizMatch = ReturnType<typeof useQuizMatch>;
