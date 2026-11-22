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

// What Play again repeats is told on the result, beside that button, and not
// here. A daily quiz already counted today never reaches the setup.
function setupNoticeText({ resumeNotice }: QuizMatch, messages: Messages): string | undefined {
  if (resumeNotice === "incompatible") return messages.quizResumeIncompatible;
  if (resumeNotice === "invalid") return messages.quizResumeInvalid;
  if (resumeNotice === "storage-unavailable") return messages.quizStorageUnavailable;
  return undefined;
}

// Only the general quiz ends with Play again, so only it says what a replay
// repeats. Today's daily result opened again from its save says it is the
// day's saved result, as when the daily quiz is picked from another mode.
function resultNoticeText({ resumeNotice, replayStatus, restoredVisit }: QuizMatch, messages: Messages, offersReplay: boolean): string | undefined {
  if (resumeNotice === "storage-unavailable") return messages.quizStorageUnavailable;
  if (!offersReplay) return restoredVisit ? messages.quizDailyDoneResult : undefined;
  return replayNoticeText(replayStatus, messages);
}

// While the session loads, the setup is already on screen with Start
// disabled: the server renders it, so the card keeps its final height and
// the content below does not shift when the data arrives.
// The server has no localStorage or URL, so its HTML marks the default mode,
// theme and timer as selected. hydrate() reuses that DOM without patching
// class attributes, so the default card would stay highlighted next to the
// stored choice. Changing choicesKey after the first effect remounts the
// choices with client state, but not the "Customize" <details>, which stays
// open if the player opened it first. The summary line may then grow from one
// line to two (Expert with the timer); on phones it keeps room for two lines,
// so the cards and Start do not move.
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
        ? messages.quizGeneralInProgress(dailyDoneGeneralResume.question, dailyDoneGeneralResume.total)
        : undefined}
      {...(shareUrl !== undefined ? { shareUrl } : {})}
    />
  );
}

/**
 * Date of today's daily quiz when the setup on screen is for it and the day
 * already counts (ADR 030), so picking the daily quiz shows the day's result
 * instead of a second round of it. A setup left over from another kind of
 * quiz, before the daily one loads, is not checked.
 */
function countedDailyDate({ state, session, loadedRequestKey }: QuizMatch, settings: QuizSettings): string | undefined {
  if (state !== "setup" || !session || loadedRequestKey !== settings.requestKey) return undefined;
  const date = quizDailyDate(session, settings.theme);
  return date !== undefined && isDailyMatchRecorded("quiz", date) ? date : undefined;
}

/** Actions shared by both finished-daily layouts: setup shortcut, general quiz, in-progress note. */
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
        <p class="game-actions-message" role="status" data-testid="quiz-daily-done-general-note">
          {messages.quizGeneralInProgress(generalResume.question, generalResume.total)}
        </p>
      ) : null}
      <div class="btn-row">
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

/**
 * Today's daily quiz, already finished. The result saved in this language is
 * shown read-only only when it matches the published session on screen; with
 * none (the day was played in the other language, on an earlier board of the
 * date, or the save was cleared) the shared `DailyDone` card says the day
 * counts. Both end with `DailyNext`, a shortcut to the setup, and the general
 * quiz.
 */
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
        ? messages.quizGeneralInProgress(dailyDoneGeneralResume.question, dailyDoneGeneralResume.total)
        : undefined}
    />
  );
}

/**
 * The same link in the action bar, over the round rules, so a phone shows it
 * without scrolling. One link holds the whole line, so its target is the
 * whole hint, at least 44px tall. A stale save is text only: no resume promise.
 */
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

/**
 * Says that a round is saved in progress in the other language and links to
 * it there when the save still matches the live artifact. Nothing is deleted:
 * starting a game here uses this language's own slot, and the other round
 * stays saved until it is finished or cleared there.
 */
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
    // Below the setup card: the notice appears after hydration, and there it
    // moves neither the card nor its action bar (rule 4 of the UX contract).
    // While loading, the language's own round may still be restored, so the
    // notice waits for the setup.
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
