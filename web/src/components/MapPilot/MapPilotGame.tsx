import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  mapPilotCountries,
  mapPilotCountryLabel,
  mapPilotEvents,
  mapPilotFeatures,
  mapPilotMetadata,
  selectMapPilotRound,
  type MapPilotEvent,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { clearMapPilotSave, loadMapPilotSave, storeMapPilotSave } from "./map-pilot-save";
import { formatMapDate, MapPilotResult } from "./MapPilotResult";

interface MapPilotGameProps {
  locale: Locale;
  seedDate?: string;
}

interface Copy {
  loading: string;
  empty: string;
  question: (date: string) => string;
  instructions: string;
  mapLabel: string;
  resultMapLabel: string;
  countryChoices: string;
  pickPlaceholder: string;
  answer: string;
  correct: string;
  incorrect: string;
  answerWas: string;
  yourAnswer: string;
  next: string;
  finish: string;
  complete: string;
  evidence: string;
  musicBrainz: string;
  scheduleNote: string;
  checkedAt: (date: string) => string;
  mapCredit: string;
  roundProgress: (current: number, total: number) => string;
}

/** How long Next ignores activation after it replaces the answer controls. */
export const NEXT_GUARD_MS = 300;

// Equirectangular 1200x600 map cropped to 84°N–60°S. The polar rows hold no tour dates.
const MAP_VIEW_BOX = "0 20 1200 480";

const COPY: Record<Locale, Copy> = {
  "pt-BR": {
    loading: "Preparando a rodada de hoje…",
    empty: "Não há perguntas de mapa disponíveis.",
    question: (date) => `Em qual país a agenda oficial listou um show de BLACKPINK em ${date}?`,
    instructions: "Escolha um país destacado no mapa ou na lista.",
    mapLabel: "Mapa interativo de países. Use Tab e Enter para escolher uma área destacada.",
    resultMapLabel: "Mapa com os países das datas desta rodada.",
    countryChoices: "Países desta rodada",
    pickPlaceholder: "Escolha um país",
    answer: "Responder",
    correct: "Resposta correta.",
    incorrect: "Essa não é a resposta.",
    answerWas: "País correto",
    yourAnswer: "Sua resposta",
    next: "Próxima data",
    finish: "Ver resultado",
    complete: "Rodada concluída",
    evidence: "Agenda oficial",
    musicBrainz: "MusicBrainz",
    scheduleNote: "A data aparece na agenda. Isso não confirma que o show aconteceu.",
    checkedAt: (date) => `Conferida em ${date}.`,
    mapCredit: "Dados cartográficos: Natural Earth, domínio público.",
    roundProgress: (current, total) => `Pergunta ${current} de ${total}`,
  },
  en: {
    loading: "Preparing today's round…",
    empty: "No map questions are available.",
    question: (date) => `Which country did the official schedule list for a BLACKPINK show on ${date}?`,
    instructions: "Choose a highlighted country on the map or in the list.",
    mapLabel: "Interactive country map. Use Tab and Enter to choose a highlighted area.",
    resultMapLabel: "Map of the countries of this round's dates.",
    countryChoices: "Countries in this round",
    pickPlaceholder: "Choose a country",
    answer: "Answer",
    correct: "Correct answer.",
    incorrect: "That is not the answer.",
    answerWas: "Correct country",
    yourAnswer: "Your answer",
    next: "Next date",
    finish: "See result",
    complete: "Round complete",
    evidence: "Official schedule",
    musicBrainz: "MusicBrainz",
    scheduleNote: "The date appears in the schedule. This does not confirm the show took place.",
    checkedAt: (date) => `Checked on ${date}.`,
    mapCredit: "Map data: Natural Earth, public domain.",
    roundProgress: (current, total) => `Question ${current} of ${total}`,
  },
};

/** The round being played: its date, the features picked and the date on screen. */
interface RoundState {
  date: string;
  answers: string[];
  index: number;
}

type ShareNotice = { kind: "copied" | "shareFailed"; n: number };

const playableFeatures = new Set(mapPilotCountries.map((country) => country.map_feature_id));
const countryByFeature = new Map(mapPilotCountries.map((country) => [country.map_feature_id, country]));

export function MapPilotGame({ locale, seedDate }: MapPilotGameProps) {
  const copy = COPY[locale];
  const messages = getMessages(locale);
  // The static build and the visitor's browser disagree on "today", so the
  // daily round and its save are read only after hydration.
  const [game, setGame] = useState<RoundState | null>(null);
  useEffect(() => {
    if (game !== null) return;
    const date = seedDate ?? new Date().toISOString().slice(0, 10);
    const saved = loadMapPilotSave(date, selectMapPilotRound(mapPilotEvents, date), playableFeatures);
    setGame({ date, answers: saved?.answers ?? [], index: saved?.index ?? 0 });
  }, [game, seedDate]);
  const roundDate = game?.date ?? null;
  const round = useMemo(
    () => (roundDate === null ? [] : selectMapPilotRound(mapPilotEvents, roundDate)),
    [roundDate],
  );

  const [listChoice, setListChoice] = useState("");
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

  const questionIndex = game?.index ?? 0;
  const answers = game?.answers ?? [];
  const isComplete = round.length > 0 && questionIndex >= round.length;
  const current = isComplete ? undefined : (round[questionIndex] as MapPilotEvent | undefined);
  const selectedFeature = answers.length > questionIndex ? answers[questionIndex]! : null;
  const answerCountry = current ? countryByFeature.get(current.map_feature_id) : undefined;
  const selectedCountry = selectedFeature ? countryByFeature.get(selectedFeature) : undefined;
  const answerState = selectedFeature === null || !current
    ? null
    : selectedFeature === current.map_feature_id
      ? "correct"
      : "incorrect";

  // Save after every answer and every Next, so a reload resumes the date on
  // screen or the result. An untouched round is not saved.
  useEffect(() => {
    if (game === null || round.length === 0 || game.answers.length === 0) return;
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
  // After Play another round, the first question.
  useFocusOnChange(questionTitle, restarts > 0 && !isComplete, restarts);

  const sortedCountries = useMemo(
    () => [...mapPilotCountries].sort((a, b) =>
      mapPilotCountryLabel(a, locale).localeCompare(mapPilotCountryLabel(b, locale), locale)),
    [locale],
  );

  function chooseCountry(featureId: string) {
    if (!game || !current || selectedFeature !== null || !playableFeatures.has(featureId)) return;
    playedHere.current = true;
    answeredAt.current = performance.now();
    setGame({ ...game, answers: [...game.answers, featureId] });
  }

  function nextQuestion() {
    // Next takes the place of the answer controls: the second tap of a double
    // tap, or a second Enter, meant for the answer must not skip the verdict.
    if (!game || performance.now() - answeredAt.current < NEXT_GUARD_MS) return;
    playedHere.current = true;
    setListChoice("");
    setGame({ ...game, index: game.index + 1 });
  }

  function restart() {
    if (!game) return;
    clearMapPilotSave(game.date);
    playedHere.current = true;
    answeredAt.current = -Infinity;
    setListChoice("");
    setNotice(null);
    setGame({ date: game.date, answers: [], index: 0 });
    setRestarts((value) => value + 1);
  }

  if (game === null) {
    return <section class="map-pilot-state" role="status">{copy.loading}</section>;
  }

  if (round.length === 0) {
    return <section class="map-pilot-state" role="status">{copy.empty}</section>;
  }

  const roundFeatures = new Set(round.map((event) => event.map_feature_id));

  return (
    <section
      class={`map-pilot-game${isComplete ? " is-complete" : ""}`}
      id="map-game"
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
      <div class={`game-actions map-pilot-actions${answerState ? ` is-${answerState}` : ""}`}>
        <div
          class={`game-actions-message${isComplete ? " visually-hidden" : ""}`}
          role="status"
          aria-live="polite"
        >
          {isComplete ? (
            // A new key replaces the paragraph, so a second copy is announced again.
            notice && <p key={notice.n}>{notice.kind === "copied" ? messages.copiedToClipboard : messages.shareFailed}</p>
          ) : answerState && current && answerCountry ? (
            <>
              <p class="game-actions-title">{answerState === "correct" ? copy.correct : copy.incorrect}</p>
              <p>
                {selectedCountry && answerState === "incorrect" && <>{copy.yourAnswer}: <strong>{mapPilotCountryLabel(selectedCountry, locale)}</strong> · </>}
                {copy.answerWas}: <strong>{mapPilotCountryLabel(answerCountry, locale)}</strong>
              </p>
              <p class="map-pilot-evidence">
                <a href={current.source_url} target="_blank" rel="noreferrer">{copy.evidence}</a>
                <a href={current.musicbrainz_event_url} target="_blank" rel="noreferrer">{copy.musicBrainz}</a>
                <span>{copy.checkedAt(formatMapDate(current.source_checked_at, locale, "short"))} {copy.scheduleNote}</span>
              </p>
            </>
          ) : (
            <p class="game-actions-hint">{copy.instructions}</p>
          )}
        </div>
        {isComplete ? (
          <MapPilotResult
            roundDate={game.date}
            round={round}
            answers={answers}
            countryByFeature={countryByFeature}
            locale={locale}
            onRestart={restart}
            onCopied={() => setNotice({ kind: "copied", n: ++notices.current })}
            onShareFailed={() => setNotice({ kind: "shareFailed", n: ++notices.current })}
            titleRef={resultTitle}
          />
        ) : answerState ? (
          <button
            ref={nextButton}
            class="btn btn-primary"
            type="button"
            onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
            onClick={nextQuestion}
          >
            {questionIndex + 1 === round.length ? copy.finish : copy.next}
          </button>
        ) : (
          // Narrow screens have no room for the list beside the map: the same
          // countries sit in the bar as a select with its answer button.
          <form
            class="map-pilot-pick"
            onSubmit={(event) => {
              event.preventDefault();
              if (listChoice) chooseCountry(listChoice);
            }}
          >
            <select
              class="map-pilot-select"
              aria-label={copy.countryChoices}
              value={listChoice}
              onChange={(event) => setListChoice((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="" disabled>{copy.pickPlaceholder}</option>
              {sortedCountries.map((country) => (
                <option key={country.map_feature_id} value={country.map_feature_id}>
                  {mapPilotCountryLabel(country, locale)}
                </option>
              ))}
            </select>
            <button class="btn btn-primary" type="submit" disabled={!listChoice}>{copy.answer}</button>
          </form>
        )}
      </div>
    </section>
  );
}
