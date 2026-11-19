import { useCallback, useEffect, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { GroupPageArtifactError, loadGroupQuizSession } from "../../data/group-page-loader";
import { groupPagePath } from "../../lib/group-pages";
import { seoAbsoluteUrl } from "../../lib/seo-routes";
import type { Locale } from "../../lib/quiz-types";
import {
  advanceRound,
  confirmGiveUp,
  expireQuestion,
  revealClue,
  startRound,
  submitAnswer,
} from "../Quiz/quiz-round-actions";
import { applyRound } from "../Quiz/quiz-round-state";
import { restartRound } from "../Quiz/quiz-replay";
import { QuizScreen } from "../Quiz/QuizScreen";
import type { QuizLoadContext, QuizPlayContext } from "../Quiz/types";
import { useQuizAnalytics } from "../Quiz/useQuizAnalytics";
import { useQuizFocus } from "../Quiz/useQuizFocus";
import { useQuizMatch } from "../Quiz/useQuizMatch";
import { useGroupQuizSettings } from "../Quiz/useQuizSettings";
import { useQuizTimer } from "../Quiz/useQuizTimer";

interface Props {
  slug: string;
  locale: Locale;
  baseUrl?: string;
  startLabel: string;
  startBlurb: string;
}

/**
 * Fixed-session quiz for a group landing page. Loads the published session
 * for the slug, keeps theme `history` (free play), and never touches the
 * home quiz URL params, localStorage progress slots, preferences, or
 * kpop-player-stats-v1.
 */
export function GroupQuizGame({ slug, locale, baseUrl, startLabel, startBlurb }: Props) {
  const messages = getMessages(locale);
  const settings = useGroupQuizSettings(locale);
  const match = useQuizMatch();
  const [hydrated, setHydrated] = useState(false);
  const [awaitingStart, setAwaitingStart] = useState(false);
  const analytics = useQuizAnalytics(locale, settings, match);
  const persistProgress = useCallback(() => undefined, []);
  const question = match.session?.questions[match.questionIndex];
  const timerSeconds = settings.timerEnabled ? 20 : match.session?.config.timer_seconds ?? null;
  const play: QuizPlayContext = { locale, settings, match, question, timerSeconds, persistProgress, analytics };
  const shareUrl = seoAbsoluteUrl(groupPagePath(slug, locale));

  const { secondsLeft, stopTimer } = useQuizTimer({
    active: match.state === "question.ready" && Boolean(question),
    deadlineMs: match.state === "question.ready" ? match.deadlineMs : null,
    onExpire: () => expireQuestion(play),
  });
  const loading: QuizLoadContext = { ...play, stopTimer };

  const load = () => {
    match.loadRequestRef.current += 1;
    const requestId = match.loadRequestRef.current;
    match.setState("loading");
    match.setSession(null);
    setAwaitingStart(false);
    void loadGroupQuizSession(slug, locale, baseUrl)
      .then((session) => {
        if (requestId !== match.loadRequestRef.current) return;
        applyRound(
          { ...play, stopTimer },
          {
            session,
            availableDecades: [],
            decades: [],
            source: "published",
            replayStatus: null,
          },
          "setup",
        );
        setAwaitingStart(true);
      })
      .catch((err: unknown) => {
        if (requestId !== match.loadRequestRef.current) return;
        match.setState(err instanceof GroupPageArtifactError && err.kind === "missing" ? "missing" : "invalid");
      });
  };

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    load();
    return () => {
      match.loadRequestRef.current += 1;
      stopTimer();
    };
  }, [slug, locale]);

  const focus = useQuizFocus(match);

  // Keep the group start card (same height) while the session loads or waits
  // for Begin — never flash the home QuizSetupScreen.
  if (match.state === "loading" || (awaitingStart && match.state === "setup")) {
    const ready = awaitingStart && Boolean(match.session);
    return (
      <section
        id="group-quiz"
        class="game-card game-card--wide"
        data-testid="group-quiz-start"
        aria-busy={!ready || undefined}
      >
        <p>{startBlurb}</p>
        <div class="game-actions">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="group-quiz-begin"
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              setAwaitingStart(false);
              startRound(play);
            }}
          >
            {startLabel}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div id="group-quiz" data-testid="group-quiz">
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
        generalResume={null}
        otherLocaleRound={null}
        shareUrl={shareUrl}
        headingLevel={3}
        actions={{
          load,
          retryUnavailable: load,
          start: () => startRound(play),
          restart: () => restartRound(loading),
          submit: () => submitAnswer(play),
          advance: () => advanceRound(play),
          requestGiveUp: match.requestGiveUp,
          confirmGiveUp: () => confirmGiveUp(play),
          revealClue: () => revealClue(play),
          selectTheme: () => undefined,
          playGeneral: () => undefined,
        }}
      />
    </div>
  );
}
