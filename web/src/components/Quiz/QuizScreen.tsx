import type { Messages } from "../../i18n/catalog";
import type { Locale, QuizQuestion, QuizSession } from "../../lib/quiz-types";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { GameSetup } from "../GameSetup/GameSetup";
import { dailySeedDate } from "./daily-seed";
import { QuizResult } from "./QuizResult";
import { QuizRound } from "./QuizRound";
import { QuizState } from "./QuizState";
import type { ReplayNotice } from "./types";
import type { QuizFocusRefs } from "./useQuizFocus";
import type { QuizMatch } from "./useQuizMatch";
import type { QuizSettings } from "./useQuizSettings";

export interface QuizScreenActions {
  load: () => void;
  retryUnavailable: () => void;
  start: () => void;
  restart: () => void;
  submit: () => void;
  advance: () => void;
  requestGiveUp: () => void;
  confirmGiveUp: () => void;
  revealClue: () => void;
}

export interface QuizScreenProps {
  locale: Locale;
  messages: Messages;
  settings: QuizSettings;
  match: QuizMatch;
  question: QuizQuestion | undefined;
  hydrated: boolean;
  timerVisible: boolean;
  secondsLeft: number;
  focus: QuizFocusRefs;
  actions: QuizScreenActions;
}

function replayNoticeText(status: ReplayNotice, messages: Messages): string | undefined {
  if (status === "repeats") return messages.quizReplayRepeats;
  if (status === "legacy-repeats") return messages.quizReplayLegacyRepeats;
  return undefined;
}

function setupNoticeText({ resumeNotice, replayStatus }: QuizMatch, messages: Messages): string | undefined {
  if (resumeNotice === "incompatible") return messages.quizResumeIncompatible;
  if (resumeNotice === "invalid") return messages.quizResumeInvalid;
  if (resumeNotice === "storage-unavailable") return messages.quizStorageUnavailable;
  return replayNoticeText(replayStatus, messages);
}

function resultNoticeText({ resumeNotice, replayStatus }: QuizMatch, messages: Messages): string | undefined {
  return resumeNotice === "storage-unavailable"
    ? messages.quizStorageUnavailable
    : replayNoticeText(replayStatus, messages);
}

function resultDailyDate(theme: QuizSettings["theme"], session: QuizSession): string | undefined {
  if (theme !== "daily") return undefined;
  return dailySeedDate(session) ?? new Date().toISOString().slice(0, 10);
}

// While the session loads, the setup is already on screen with Start
// disabled: the server renders it, so the card keeps its final height and
// the content below does not shift when the data arrives.
// The server has no localStorage or URL, so its HTML marks the default mode,
// theme and timer as selected. hydrate() reuses that DOM without patching
// class attributes, so the default card would stay highlighted next to the
// stored choice. Changing the key after the first effect remounts the setup
// with client state; the layout is identical, so nothing shifts.
function QuizSetupScreen({ messages, settings, match, hydrated, actions }: QuizScreenProps) {
  const { state, session, loadedRequestKey } = match;
  return (
    <GameSetup key={hydrated ? "client" : "ssr"} busy={state === "loading"} busyLabel={messages.loading}
      playMode={settings.playMode} theme={settings.theme} decades={settings.decades} availableDecades={settings.availableDecades} timerEnabled={settings.timerEnabled} messages={messages}
      notice={setupNoticeText(match, messages)}
      onSelectTheme={settings.selectTheme}
      onSelectDecades={settings.selectDecades}
      onSelectMode={settings.selectMode}
      onTimerChange={settings.changeTimer}
      onStart={actions.start} isReady={state === "setup" && loadedRequestKey === settings.requestKey && session?.config.play_mode === settings.playMode}
    />
  );
}

function QuizResultScreen({ locale, messages, settings, match, focus, actions, session }: QuizScreenProps & { session: QuizSession }) {
  const { score, history, elapsedSeconds, restoredVisit, gaveUpRef } = match;
  const resultNotice = resultNoticeText(match, messages);
  return (
    <QuizResult
      score={score} totalQuestions={session.questions.length} messages={messages} locale={locale}
      correctCount={history.filter((h) => h.isCorrect).length} elapsedSeconds={elapsedSeconds}
      cluesUsedCount={history.reduce((acc, h) => acc + h.cluesUsedCount, 0)}
      playMode={settings.playMode} history={history}
      {...(restoredVisit ? {} : { headingRef: focus.resultHeadingRef })}
      onRestart={actions.restart}
      dailyDate={resultDailyDate(settings.theme, session)} feedbackEligible={!gaveUpRef.current}
      {...(resultNotice ? { notice: resultNotice } : {})}
    />
  );
}

function QuizRoundScreen({
  messages, settings, match, timerVisible, secondsLeft, focus, actions, session, question,
}: QuizScreenProps & { session: QuizSession; question: QuizQuestion }) {
  const { state, questionIndex, score, selectedId, timedOut, revealedClues, confirmGiveUpOpen, resumeNotice } = match;
  return (
    <>
      {resumeNotice === "storage-unavailable" && (
        <p class="game-actions-message" role="status" data-testid="quiz-storage-notice">
          {messages.quizStorageUnavailable}
        </p>
      )}
      <QuizRound
        session={session} question={question} questionIndex={questionIndex} score={score}
        secondsLeft={secondsLeft} timerVisible={timerVisible} selectedId={selectedId}
        onSelectOption={match.setSelectedId} answered={state === "question.answered"} timedOut={timedOut}
        revealedClues={revealedClues} playMode={settings.playMode} headingRef={focus.headingRef} actionRef={focus.nextButtonRef}
        onSubmit={actions.submit} onAdvance={actions.advance} onGiveUp={actions.requestGiveUp} onRevealClue={actions.revealClue} messages={messages}
      />
      <ConfirmDialog
        isOpen={confirmGiveUpOpen}
        title={messages.giveUpConfirmTitle}
        body={messages.giveUpConfirmBody}
        confirmLabel={messages.giveUpConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={actions.confirmGiveUp}
        onCancel={match.closeGiveUpConfirm}
      />
    </>
  );
}

/** Renders the screen for the current machine state. */
export function QuizScreen(props: QuizScreenProps) {
  const { messages, match, question, actions } = props;
  const { state, session } = match;
  if (state === "missing" || state === "invalid") {
    return (
      <QuizState
        label={state === "missing" ? messages.artifactMissing : messages.artifactInvalid}
        action={messages.retry}
        onAction={actions.load}
        wide
      />
    );
  }
  if (state === "unavailable") {
    return <QuizState label={messages.quizReplayUnavailable} action={messages.retry} onAction={actions.retryUnavailable} wide />;
  }
  if (state === "loading" || state === "setup") return <QuizSetupScreen {...props} />;
  if (state === "empty" || !session || !question) return <QuizState label={messages.empty} wide />;
  if (state === "results") return <QuizResultScreen {...props} session={session} />;
  return <QuizRoundScreen {...props} session={session} question={question} />;
}
