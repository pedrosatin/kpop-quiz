import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  mapPilotCountries,
  mapPilotCountryLabel,
  mapPilotFeatures,
  mapPilotMetadata,
  type MapPilotCountry,
  type MapPilotEvent,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { clearMapPilotSave, storeMapPilotSave } from "./map-pilot-save";
import { formatMapDate, MapPilotResult } from "./MapPilotResult";
import type { MapPilotCopy } from "./map-pilot-copy";
import {
  MapPilotFeedbackMessage,
  mapPilotBarState,
  type AnswerState,
  type ShareNotice,
} from "./map-pilot-feedback";
import { MapPilotNextButton, MapPilotPickForm } from "./MapPilotControls";

/** How long Next ignores activation after it replaces the answer controls. */
export const NEXT_GUARD_MS = 300;

// Equirectangular 1200x600 map cropped to 84°N–60°S. The polar rows hold no tour dates.
const MAP_VIEW_BOX = "0 20 1200 480";

export interface RoundState {
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
  const [gaveUpRound, setGaveUpRound] = useState(false);
  const [notice, setNotice] = useState<ShareNotice | null>(null);
  const notices = useRef(0);
  const nextButton = useRef<HTMLButtonElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const questionTitle = useRef<HTMLHeadingElement>(null);
  const answeredAt = useRef(-Infinity);
  // Only what the player does in this visit moves focus; a round restored
  // from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const [restarts, setRestarts] = useState(0);

  const questionIndex = game.index;
  const answers = game.answers;
  const isComplete = round.length > 0 && questionIndex >= round.length;
  const current = isComplete ? undefined : (round[questionIndex] as MapPilotEvent | undefined);
  const selectedFeature = answers.length > questionIndex ? answers[questionIndex]! : null;
  const answerCountry = current ? countryByFeature.get(current.map_feature_id) : undefined;
  const selectedCountry = selectedFeature ? countryByFeature.get(selectedFeature) : undefined;
  const answerState: AnswerState = selectedFeature === null || !current
    ? null
    : selectedFeature === current.map_feature_id
      ? "correct"
      : "incorrect";

  // Save after every answer and every Next, so a reload resumes the date on
  // screen or the result. An untouched round is not saved, but a finished
  // one is, even with zero answers after a give-up.
  useEffect(() => {
    if (round.length === 0 || (game.answers.length === 0 && !isComplete)) return;
    storeMapPilotSave(game.date, {
      events: round.map((event) => event.event_mbid),
      answers: game.answers,
      index: game.index,
    });
  }, [game, round]);

  // Next appears in the sticky action bar, already in view, so focusing it
  // lets Enter advance without moving the page.
  useFocusOnChange(nextButton, answerState !== null && playedHere.current, questionIndex);
  // At the end the result takes the bar, so focus its title to start reading there.
  useFocusOnChange(resultTitle, isComplete && playedHere.current);
  // After Play again, the first question.
  useFocusOnChange(questionTitle, restarts > 0 && !isComplete, restarts);

  const sortedCountries = useMemo(
    () => [...mapPilotCountries].sort((a, b) =>
      mapPilotCountryLabel(a, locale).localeCompare(mapPilotCountryLabel(b, locale), locale)),
    [locale],
  );

  function chooseCountry(featureId: string) {
    if (!current || selectedFeature !== null || !playableFeatures.has(featureId)) return;
    playedHere.current = true;
    answeredAt.current = performance.now();
    setGame({ ...game, answers: [...game.answers, featureId] });
  }

  function nextQuestion() {
    // Next takes the place of the answer controls: the second tap of a double
    // tap, or a second Enter, meant for the answer must not skip the verdict.
    if (performance.now() - answeredAt.current < NEXT_GUARD_MS) return;
    playedHere.current = true;
    setListChoice("");
    setPickPrompt(0);
    setGame({ ...game, index: game.index + 1 });
  }

  function restart() {
    clearMapPilotSave(game.date);
    playedHere.current = true;
    answeredAt.current = -Infinity;
    setListChoice("");
    setPickPrompt(0);
    setNotice(null);
    setGame({ date: game.date, answers: [], index: 0 });
    setGaveUpRound(false);
    setRestarts((value) => value + 1);
  }

  function giveUp() {
    playedHere.current = true;
    setListChoice("");
    setPickPrompt(0);
    setGaveUpRound(true);
    setGame({ ...game, index: round.length });
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
          <h2 id="map-game-title" ref={questionTitle} tabIndex={-1}>{copy.question(formatMapDate(current.event_date, locale))}</h2>
        </header>
      )}

      <div class="map-pilot-map-wrap">
        <svg
          class="map-pilot-world-map"
          viewBox={MAP_VIEW_BOX}
          role={isComplete ? "img" : "group"}
          aria-label={isComplete ? copy.resultMapLabel : copy.mapLabel}
        >
          {mapPilotFeatures.map((feature) => {
            if (!current) {
              // The finished round: the countries of its dates, not playable.
              return (
                <path
                  key={feature.id}
                  d={feature.path}
                  class={`map-pilot-feature ${roundFeatures.has(feature.id) ? "is-answer" : ""}`}
                  fill-rule="evenodd"
                />
              );
            }
            const isPlayable = playableFeatures.has(feature.id);
            const isSelected = selectedFeature === feature.id;
            const isCorrect = selectedFeature !== null && current.map_feature_id === feature.id;
            return (
              <path
                key={feature.id}
                d={feature.path}
                class={`map-pilot-feature ${isPlayable ? "is-playable" : ""} ${isSelected ? "is-selected" : ""} ${isCorrect ? "is-answer" : ""}`}
                fill-rule="evenodd"
                role={isPlayable ? "button" : undefined}
                // Preact writes SVG attributes as spelled, and SVG only reads the
                // lowercase names: tabIndex and fillRule did nothing, and Tab
                // skipped the map.
                tabindex={isPlayable && selectedFeature === null ? 0 : -1}
                aria-label={isPlayable ? mapPilotCountryLabel(countryByFeature.get(feature.id)!, locale) : undefined}
                aria-pressed={isPlayable ? isSelected : undefined}
                onClick={isPlayable ? () => chooseCountry(feature.id) : undefined}
                onKeyDown={isPlayable ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    chooseCountry(feature.id);
                  }
                } : undefined}
              />
            );
          })}
        </svg>
        <p class="map-pilot-attribution">{copy.mapCredit} {mapPilotMetadata.mapVersion} · {mapPilotMetadata.mapScale}</p>
      </div>

      {current && (
        // Beside the map on wide screens; narrow screens use the select in the bar.
        <div class="map-pilot-answers" role="group" aria-labelledby="map-country-choices">
          <h3 id="map-country-choices" class="visually-hidden">{copy.countryChoices}</h3>
          <div class="map-pilot-country-list">
            {sortedCountries.map((country) => (
              <button
                key={country.map_feature_id}
                type="button"
                class={`map-pilot-country ${selectedFeature === country.map_feature_id ? "is-selected" : ""} ${selectedFeature !== null && country.map_feature_id === current.map_feature_id ? "is-answer" : ""}`}
                disabled={selectedFeature !== null}
                onClick={() => chooseCountry(country.map_feature_id)}
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
            onRestart={restart}
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
            onChooseCountry={chooseCountry}
            onEmptySubmit={() => setPickPrompt((value) => value + 1)}
          />
        )}
        {!isComplete && (
          <button type="button" class="btn btn-secondary" onClick={giveUp}>
            {messages.giveUp}
          </button>
        )}
      </div>
    </section>
  );
}
