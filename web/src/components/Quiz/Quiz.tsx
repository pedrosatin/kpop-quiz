import { useEffect, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { groupEvidence } from "./AnswerFeedback";
import { loadRound } from "./quiz-load";
import { restartRound } from "./quiz-replay";
import {
  advanceRound,
  confirmGiveUp,
  expireQuestion,
  requestGiveUp,
  revealClue,
  startRound,
  submitAnswer,
} from "./quiz-round-actions";
import { QuizScreen } from "./QuizScreen";
import type { QuizLoadContext, QuizPlayContext } from "./types";
import { useQuizAnalytics } from "./useQuizAnalytics";
import { useQuizFocus } from "./useQuizFocus";
import { useQuizMatch } from "./useQuizMatch";
import { useQuizProgressAutosave, useQuizProgressWriter } from "./useQuizProgress";
import { useQuizSettings } from "./useQuizSettings";
import { useGeneralResume } from "./useGeneralResume";
import { useQuizTimer } from "./useQuizTimer";
import { useRecordQuizMatch } from "./useRecordQuizMatch";
import type { QuizDecadeValue } from "./url-params";

export { groupEvidence };

export function Quiz({ locale, initialAvailableDecades = [] }: {
  locale: Locale;
  /** Decades computed from the manifest at build time, so the server-rendered setup matches the loaded one. */
  initialAvailableDecades?: QuizDecadeValue[];
}) {
  const messages = getMessages(locale);
  const settings = useQuizSettings(locale, initialAvailableDecades);
  const match = useQuizMatch();
  const generalResume = useGeneralResume(locale, settings);
  const [hydrated, setHydrated] = useState(false);
  const analytics = useQuizAnalytics(locale, settings, match);
  const persistProgress = useQuizProgressWriter(locale, settings, match);
  const question = match.session?.questions[match.questionIndex];
  const timerSeconds = settings.timerEnabled ? 20 : match.session?.config.timer_seconds ?? null;
  const play: QuizPlayContext = { locale, settings, match, question, timerSeconds, persistProgress, analytics };

  const { secondsLeft, stopTimer } = useQuizTimer({
    active: match.state === "question.ready" && Boolean(question),
    deadlineMs: match.state === "question.ready" ? match.deadlineMs : null,
    onExpire: () => expireQuestion(play),
  });
  const loading: QuizLoadContext = { ...play, stopTimer };
  const load = () => loadRound(loading);

  // Effects run in call order and some depend on it: a timer that expires
  // while restoring a save runs before the autosave at the end of this list.
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    load();
    return () => { match.loadRequestRef.current += 1; stopTimer(); };
  }, [locale, settings.playMode, settings.theme, settings.decadeKey]);

  const focus = useQuizFocus(match);
  useRecordQuizMatch(match.state, match.session, match.history, settings.theme, match.recordedMatchRef);
  useQuizProgressAutosave(match, persistProgress);

  return (
    <QuizScreen
      locale={locale}
      messages={messages}
      settings={settings}
      match={match}
      question={question}
      hydrated={hydrated}
      timerVisible={timerSeconds !== null}
      secondsLeft={secondsLeft}
      focus={focus}
      generalResume={generalResume}
      actions={{
        load,
        // Clearing filters changes decadeKey and reloads through the effect.
        retryUnavailable: () => { if (!settings.clearDecadeFilter()) load(); },
        start: () => startRound(play),
        restart: () => restartRound(loading),
        submit: () => submitAnswer(play),
        advance: () => advanceRound(play),
        requestGiveUp: () => requestGiveUp(match),
        confirmGiveUp: () => confirmGiveUp(play),
        revealClue: () => revealClue(play),
        selectTheme: (theme) => {
          // Picking the general quiz while it says where it stopped restores
          // that round; its question then takes the focus from the card.
          if (theme === "history" && generalResume) match.focusRestoredRef.current = true;
          settings.selectTheme(theme);
        },
      }}
    />
  );
}
