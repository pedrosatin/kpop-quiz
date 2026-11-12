import { useGameAnalytics, type GameOutcome } from "../../lib/game-analytics";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  mapPilotCountries,
  mapPilotCountryLabel,
  type MapPilotCountry,
  type MapPilotEvent,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { storeMapPilotSave } from "./map-pilot-save";
import { useRecordMapMatch } from "./useRecordMapMatch";
import { formatMapDate, MapPilotResult } from "./MapPilotResult";
import type { MapPilotCopy } from "./map-pilot-copy";
import {
  MapPilotFeedbackMessage,
  mapPilotBarState,
  type AnswerState,
  type ShareNotice,
} from "./map-pilot-feedback";
import { MapPilotNextButton, MapPilotPickForm } from "./MapPilotControls";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { MapPilotMap } from "./MapPilotMap";

/** How long Next ignores activation after it replaces the answer controls. */
export const NEXT_GUARD_MS = 300;

export interface RoundState {
  gaveUp?: boolean;
  replay?: boolean;
  date: string;
  answers: string[];
  index: number;
}

export interface MapPilotGameContentProps {
  locale: Locale;
  copy: MapPilotCopy;
  game: RoundState;
  setGame: (game: RoundState) => void;
  round: MapPilotEvent[];
  playableFeatures: Set<string>;
  countryByFeature: Map<string, MapPilotCountry>;
}

/** The Map shows only a score, so a win follows the Quiz rule: at least half right. */
function mapRoundOutcome(round: MapPilotEvent[], answers: string[], gaveUp: boolean): GameOutcome {
  if (gaveUp || answers.length < round.length) return "give_up";
  const correct = round.filter((event, index) => answers[index] === event.map_feature_id).length;
  return correct >= Math.ceil(round.length / 2) ? "win" : "loss";
}

export function MapPilotGameContent({
  locale,
  copy,
  game,
  setGame,
  round,
  playableFeatures,
  countryByFeature,
}: MapPilotGameContentProps) {
  const messages = getMessages(locale);
  const [listChoice, setListChoice] = useState("");
  // Answer pressed with no country picked: the live region says so.
  const [pickPrompt, setPickPrompt] = useState(0);
  const gaveUpRound = game.gaveUp === true;
  const [notice, setNotice] = useState<ShareNotice | null>(null);
  const notices = useRef(0);
  const nextButton = useRef<HTMLButtonElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const answeredAt = useRef(-Infinity);
  // Only what the player does in this visit moves focus; a round restored
  // from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const confirmGiveUpOpenRef = useRef(false);

  const questionIndex = game.index;
  const answers = game.answers;
  const isComplete = round.length > 0 && questionIndex >= round.length;
  const outcome = isComplete ? mapRoundOutcome(round, answers, gaveUpRound) : null;
  const analytics = useGameAnalytics(
    {
      game: "map",
      locale,
      // The save is what remembers a replay.
      isDaily: () => !game.replay,
      outcome,
    },
    isComplete,
    answers.length > 0,
  );
  useRecordMapMatch(game.date, isComplete, outcome === "win", game.replay === true);
  const current = isComplete ? undefined : (round[questionIndex] as MapPilotEvent | undefined);
  const selectedFeature = answers.length > questionIndex ? answers[questionIndex]! : null;
  // Pending pick from map/list/select; only Responder commits it into answers.
  const pendingFeature = listChoice || null;
  const highlightFeature = selectedFeature ?? pendingFeature;
  const answerCountry = current ? countryByFeature.get(current.map_feature_id) : undefined;
  const selectedCountry = selectedFeature ? countryByFeature.get(selectedFeature) : undefined;
  const answerState: AnswerState = selectedFeature === null || !current
    ? null
    : selectedFeature === current.map_feature_id
      ? "correct"
      : "incorrect";

  // Save after every answer and every Next, so a reload resumes the date on
  // screen or the result. An untouched round is not saved, but a finished
  // one is, even with zero answers after a give-up. So is a replay, or a reload
  // would turn it back into the day's round.
  useEffect(() => {
    if (round.length === 0 || (game.answers.length === 0 && !isComplete && !game.replay)) return;
    storeMapPilotSave(game.date, {
      events: round.map((event) => event.event_mbid),
      answers: game.answers,
      index: game.index,
      ...(game.gaveUp ? { gaveUp: true } : {}),
      ...(game.replay ? { replay: true } : {}),
    });
  }, [game, round]);

  // Next appears in the sticky action bar, already in view, so focusing it
  // lets Enter advance without moving the page.
  useFocusOnChange(nextButton, answerState !== null && playedHere.current, questionIndex);
  // At the end the result takes the bar, so focus its title to start reading there.
  useFocusOnChange(resultTitle, isComplete && playedHere.current);

  const sortedCountries = useMemo(
    () => [...mapPilotCountries].sort((a, b) =>
      mapPilotCountryLabel(a, locale).localeCompare(mapPilotCountryLabel(b, locale), locale)),
    [locale],
  );

  function selectPending(featureId: string) {
    if (!current || selectedFeature !== null || !playableFeatures.has(featureId)) return;
    analytics.start();
    playedHere.current = true;
    setListChoice(featureId);
    setPickPrompt(0);
  }

  function submitAnswer(featureId: string) {
    if (!current || selectedFeature !== null || !playableFeatures.has(featureId)) return;
    analytics.start();
    playedHere.current = true;
    answeredAt.current = performance.now();
    setListChoice("");
    setPickPrompt(0);
    setGame({ ...game, answers: [...game.answers, featureId] });
  }

  function nextQuestion() {
    // Next takes the place of the answer controls: the second tap of a double
    // tap, or a second Enter, meant for the answer must not skip the verdict.
    if (performance.now() - answeredAt.current < NEXT_GUARD_MS) return;
    analytics.start();
    playedHere.current = true;
    setListChoice("");
    setPickPrompt(0);
    setGame({ ...game, index: game.index + 1 });
  }

  function closeGiveUpConfirm() {
    confirmGiveUpOpenRef.current = false;
    setConfirmGiveUpOpen(false);
  }

  function requestGiveUp() {
    if (isComplete) return;
    confirmGiveUpOpenRef.current = true;
    setConfirmGiveUpOpen(true);
  }

  function confirmGiveUp() {
    if (!confirmGiveUpOpenRef.current || isComplete) return;
    closeGiveUpConfirm();
    analytics.start();
    playedHere.current = true;
    setListChoice("");
    setPickPrompt(0);
    setGame({ ...game, index: round.length, gaveUp: true });
  }

  const roundFeatures = new Set(round.map((event) => event.map_feature_id));
  const barState = mapPilotBarState(answerState);

  return (
    <section
      class={`map-pilot-game${isComplete ? " is-complete" : ""}`}
      id="map-game"
      data-testid="game-board"
      {...(isComplete ? {} : { "aria-labelledby": "map-game-title" })}
    >
      {current && (
        <header class="map-pilot-question-header">
          <p class="map-pilot-progress" aria-live="polite">{copy.roundProgress(questionIndex + 1, round.length)}</p>
          <h2 id="map-game-title" tabIndex={-1}>{copy.question(formatMapDate(current.event_date, locale))}</h2>
        </header>
      )}

      <MapPilotMap
        locale={locale}
        copy={copy}
        current={current}
        questionIndex={questionIndex}
        playableFeatures={playableFeatures}
        roundFeatures={roundFeatures}
        countryByFeature={countryByFeature}
        selectedFeature={selectedFeature}
        highlightFeature={highlightFeature}
        onSelect={selectPending}
      />

      {current && (
        // Beside the map on wide screens; narrow screens use the select in the bar.
        <div class="map-pilot-answers" role="group" aria-labelledby="map-country-choices">
          <h3 id="map-country-choices" class="map-pilot-country-heading">{copy.countryChoices}</h3>
          <div class="map-pilot-country-list">
            {sortedCountries.map((country) => (
              <button
                key={country.map_feature_id}
                type="button"
                class={`map-pilot-country ${highlightFeature === country.map_feature_id ? "is-selected" : ""} ${selectedFeature !== null && country.map_feature_id === current.map_feature_id ? "is-answer" : ""}`}
                disabled={selectedFeature !== null}
                onClick={() => selectPending(country.map_feature_id)}
                data-testid={`answer-country-${country.iso_3166_1}`}
              >
                {mapPilotCountryLabel(country, locale)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Only the message is a live region, so the buttons and links are not announced. */}
      <div class={`game-actions map-pilot-actions${barState}`}>
        <div
          class={`game-actions-message${isComplete ? " visually-hidden" : ""}`}
          role="status"
          aria-live="polite"
        >
          <MapPilotFeedbackMessage
            isComplete={isComplete}
            answerState={answerState}
            current={current}
            answerCountry={answerCountry}
            selectedCountry={selectedCountry}
            pickPrompt={pickPrompt}
            notice={notice}
            locale={locale}
            copy={copy}
            messages={messages}
          />
        </div>
        {isComplete ? (
          <MapPilotResult
            roundDate={game.date}
            round={round}
            answers={answers}
            countryByFeature={countryByFeature}
            locale={locale}
            gaveUp={gaveUpRound || answers.length < round.length}
            onCopied={() => setNotice({ kind: "copied", n: ++notices.current })}
            onShareFailed={() => setNotice({ kind: "shareFailed", n: ++notices.current })}
            titleRef={resultTitle}
          />
        ) : answerState ? (
          <MapPilotNextButton
            buttonRef={nextButton}
            label={questionIndex + 1 === round.length ? copy.finish : copy.next}
            onNext={nextQuestion}
          />
        ) : (
          <MapPilotPickForm
            listChoice={listChoice}
            sortedCountries={sortedCountries}
            locale={locale}
            copy={copy}
            onListChoice={setListChoice}
            onClearPickPrompt={() => setPickPrompt(0)}
            onChooseCountry={submitAnswer}
            onEmptySubmit={() => setPickPrompt((value) => value + 1)}
          />
        )}
        {/* After an answer the bar keeps only Next: giving up waits for the next date. */}
        {!isComplete && answerState === null && (
          <button type="button" class="btn btn-secondary" onClick={requestGiveUp}>
            {messages.giveUp}
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmGiveUpOpen}
        title={messages.giveUpConfirmTitle}
        body={messages.giveUpConfirmBody}
        confirmLabel={messages.giveUpConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={confirmGiveUp}
        onCancel={closeGiveUpConfirm}
      />
    </section>
  );
}
