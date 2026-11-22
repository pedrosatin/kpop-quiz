import type { Messages } from "../../i18n/catalog";
import type { Locale, QuizQuestion, QuizSession } from "../../lib/quiz-types";
import { isDailyMatchRecorded } from "../../lib/player-stats";
import { useMemo } from "preact/hooks";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { GameSetup } from "../GameSetup/GameSetup";
import { DailyDone } from "../Results/DailyDone";
import { quizDailyDate } from "./daily-seed";
import { QuizResult } from "./QuizResult";
import { findFinishedDailySave } from "./saved-rounds";
import { expandHistory } from "./storage";
import { QuizRound } from "./QuizRound";
import { QuizState } from "./QuizState";
import type { ReplayNotice } from "./types";
import type { QuizFocusRefs } from "./useQuizFocus";
import type { QuizMatch } from "./useQuizMatch";
import type { QuizSettings } from "./useQuizSettings";
import type { GeneralResume } from "./useGeneralResume";
import type { OtherLocaleRound } from "./useOtherLocaleRound";
import type { QuizTheme } from "./url-params";
import { StaleDailyNotice } from "../Results/StaleDailyNotice";

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
  selectTheme: (theme: QuizTheme) => void;
  /** Leaves today's finished daily quiz for the general quiz setup. */
  playGeneral: () => void;
  /**
   * Opens the general setup without restoring a saved general round, so the
   * player can change mode from the finished daily screen.
   */
  openSetup: () => void;
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
  /** Where a general quiz saved in this language and mode stopped, on a visit that fell on today's challenge. */
  generalResume?: GeneralResume | null;
  /** Same note for the finished daily screen, even when the URL already names the daily theme. */
  dailyDoneGeneralResume?: GeneralResume | null;
  /** A round saved in progress in the other language, which the setup offers to resume there. */
  otherLocaleRound?: OtherLocaleRound | null;
  /** Overrides the default home-quiz share URL (used by group landing pages). */
  shareUrl?: string | undefined;
  /** Inside a group-page section (already an h2), demote the prompt to h3. */
  headingLevel?: 2 | 3;
}

function replayNoticeText(status: ReplayNotice, messages: Messages): string | undefined {
  if (status === "repeats") return messages.quizReplayRepeats;
  if (status === "legacy-repeats") return messages.quizReplayLegacyRepeats;
  return undefined;
}

function setupNoticeText({ resumeNotice }: QuizMatch, messages: Messages): string | undefined {
  if (resumeNotice === "incompatible") return messages.quizResumeIncompatible;
  if (resumeNotice === "invalid") return messages.quizResumeInvalid;
  if (resumeNotice === "storage-unavailable") return messages.quizStorageUnavailable;
  return undefined;
}

function resultNoticeText({ resumeNotice, replayStatus, restoredVisit }: QuizMatch, messages: Messages, offersReplay: boolean): string | undefined {
  if (resumeNotice === "storage-unavailable") return messages.quizStorageUnavailable;
  if (!offersReplay) return restoredVisit ? messages.quizDailyDoneResult : undefined;
  return replayNoticeText(replayStatus, messages);
}

function QuizSetupScreen({ messages, settings, match, hydrated, actions, generalResume, focus, otherLocaleRound }: QuizScreenProps) {
  const { state, session, loadedRequestKey } = match;
  return (
    <GameSetup choicesKey={hydrated ? "client" : "ssr"} busy={state === "loading"} busyLabel={messages.loading}
      playMode={settings.playMode} theme={settings.theme} decades={settings.decades} availableDecades={settings.availableDecades} timerEnabled={settings.timerEnabled} messages={messages}
      notice={setupNoticeText(match, messages)}
      generalNote={generalResume ? messages.quizGeneralInProgress(generalResume.question, generalResume.total) : undefined}
      onSelectTheme={actions.selectTheme}
      onSelectDecades={settings.selectDecades}
      onSelectMode={settings.selectMode}
      onTimerChange={settings.changeTimer}
      onStart={actions.start} isReady={state === "setup" && loadedRequestKey === settings.requestKey && session?.config.play_mode === settings.playMode}
      headingRef={focus.setupHeadingRef}
      hint={state === "setup" && otherLocaleRound
        ? <OtherLocaleHint round={otherLocaleRound} messages={messages} />
        : undefined}
    />
  );
}

function QuizResultScreen({
  locale, messages, settings, match, focus, actions, session, shareUrl, dailyDoneGeneralResume,
}: QuizScreenProps & { session: QuizSession }) {
  const { score, history, elapsedSeconds, restoredVisit, gaveUpRef } = match;
  const dailyDate = quizDailyDate(session, settings.theme);
  const resultNotice = resultNoticeText(match, messages, !dailyDate);
  return (
    <QuizResult
      score={score} totalQuestions={session.questions.length} messages={messages} locale={locale}
      correctCount={history.filter((h) => h.isCorrect).length} elapsedSeconds={elapsedSeconds}
      cluesUsedCount={history.reduce((acc, h) => acc + h.cluesUsedCount, 0)}
      playMode={settings.playMode} history={history}
      {...(restoredVisit ? {} : { headingRef: focus.resultHeadingRef })}
      onRestart={actions.restart}
      dailyDate={dailyDate} feedbackEligible={!gaveUpRef.current}
      {...(resultNotice ? { notice: resultNotice } : {})}
      onPlayGeneral={actions.playGeneral}
      onOpenSetup={dailyDate ? actions.openSetup : undefined}
      generalNote={dailyDate && dailyDoneGeneralResume
        ? messages.quizDailyDoneGeneralNote(dailyDoneGeneralResume.question, dailyDoneGeneralResume.total)
        : undefined}
      {...(shareUrl !== undefined ? { shareUrl } : {})}
    />
  );
}

function countedDailyDate({ state, session, loadedRequestKey }: QuizMatch, settings: QuizSettings): string | undefined {
  if (state !== "setup" || !session || loadedRequestKey !== settings.requestKey) return undefined;
  const date = quizDailyDate(session, settings.theme);
  return date !== undefined && isDailyMatchRecorded("quiz", date) ? date : undefined;
}

function DailyDoneActions({
  messages,
  actions,
  generalResume,
}: {
  messages: Messages;
  actions: QuizScreenActions;
  generalResume?: GeneralResume | null;
}) {
  return (
    <>
      {generalResume ? (
        <p class="quiz-daily-done-note" role="status" data-testid="quiz-daily-done-general-note">
          {messages.quizDailyDoneGeneralNote(generalResume.question, generalResume.total)}
        </p>
      ) : null}
      <div class="quiz-daily-done-actions">
        <button class="btn btn-secondary" type="button" data-testid="quiz-open-setup" onClick={actions.openSetup}>
          {messages.quizOpenSetup}
        </button>
        <button class="btn btn-secondary" type="button" data-testid="quiz-play-general" onClick={actions.playGeneral}>
          {messages.quizPlayGeneral}
        </button>
      </div>
    </>
  );
}

function QuizDailyDoneScreen({
  locale, messages, settings, actions, date, match, dailyDoneGeneralResume,
}: QuizScreenProps & { date: string }) {
  const published = match.session;
  const save = useMemo(
    () => (published ? findFinishedDailySave(locale, date, settings.playMode, published) : null),
    [locale, date, settings.playMode, published],
  );
  const history = save ? expandHistory(save.history, save.session) : null;
  if (!save || !history) {
    return (
      <DailyDone game="quiz" locale={locale} body={messages.quizDailyDoneBody} wide referenceDate={date}>
        <DailyDoneActions
          messages={messages}
          actions={actions}
          {...(dailyDoneGeneralResume != null ? { generalResume: dailyDoneGeneralResume } : {})}
        />
      </DailyDone>
    );
  }
  return (
    <QuizResult
      score={save.score} totalQuestions={save.session.questions.length} messages={messages} locale={locale}
      correctCount={history.filter((h) => h.isCorrect).length} elapsedSeconds={save.elapsed_seconds}
      cluesUsedCount={history.reduce((acc, h) => acc + h.cluesUsedCount, 0)}
      playMode={save.play_mode} history={history}
      onRestart={actions.playGeneral}
      dailyDate={date} feedbackEligible={false}
      notice={messages.quizDailyDoneResult}
      onPlayGeneral={actions.playGeneral}
      onOpenSetup={actions.openSetup}
      generalNote={dailyDoneGeneralResume
        ? messages.quizDailyDoneGeneralNote(dailyDoneGeneralResume.question, dailyDoneGeneralResume.total)
        : undefined}
    />
  );
}

function OtherLocaleHint({ round, messages }: { round: OtherLocaleRound; messages: Messages }) {
  if (!round.resumable) {
    return (
      <p class="setup-hint-stale" role="status" data-testid="quiz-other-locale-hint">
        {messages.quizOtherLocaleStaleHint}
      </p>
    );
  }
  return (
    <a class="setup-hint-link" href={round.href} hreflang={round.locale} data-testid="quiz-other-locale-hint">
      {messages.quizOtherLocaleHint(round.question)}
    </a>
  );
}

function OtherLocaleNotice({ round, messages }: { round: OtherLocaleRound; messages: Messages }) {
  return (
    <div class="callout other-locale-round" data-testid="quiz-other-locale-round">
      <p role="status">
        {round.resumable
          ? messages.quizOtherLocaleRound(round.theme === "daily", round.question, round.total)
          : messages.quizOtherLocaleStale(round.theme === "daily")}
      </p>
      {round.resumable ? (
        <a class="btn btn-secondary" href={round.href} hreflang={round.locale} data-testid="quiz-other-locale-resume">
          {messages.quizOtherLocaleResume}
        </a>
      ) : null}
    </div>
  );
}

function QuizRoundScreen({
  messages, settings, match, timerVisible, secondsLeft, focus, actions, session, question, headingLevel,
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
        {...(headingLevel !== undefined ? { headingLevel } : {})}
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

/** Renders the screen for the current machine state, under the notice of a daily session from an earlier day. */
export function QuizScreen(props: QuizScreenProps) {
  const { locale, settings, match } = props;
  return (
    <>
      {settings.theme === "daily" && <StaleDailyNotice board={match.session} locale={locale} />}
      <QuizStateScreen {...props} />
    </>
  );
}

function QuizStateScreen(props: QuizScreenProps) {
  const { messages, settings, match, question, actions } = props;
  const { state, session } = match;
  const doneDate = countedDailyDate(match, settings);
  if (doneDate) return <QuizDailyDoneScreen {...props} date={doneDate} />;
  if (state === "missing" || state === "invalid") {
    return (
      <QuizState
        label={state === "missing" ? messages.artifactMissing : messages.artifactInvalid}
        action={messages.retry}
        onAction={actions.load}
        wide
        errorKind={state}
      />
    );
  }
  if (state === "unavailable") {
    return <QuizState label={messages.quizReplayUnavailable} action={messages.retry} onAction={actions.retryUnavailable} wide />;
  }
  if (state === "loading" || state === "setup") {
    return (
      <>
        <QuizSetupScreen {...props} />
        {state === "setup" && props.otherLocaleRound && <OtherLocaleNotice round={props.otherLocaleRound} messages={messages} />}
      </>
    );
  }
  if (state === "empty" || !session || !question) return <QuizState label={messages.empty} wide />;
  if (state === "results") return <QuizResultScreen {...props} session={session} />;
  return <QuizRoundScreen {...props} session={session} question={question} />;
}
