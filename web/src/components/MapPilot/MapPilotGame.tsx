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

interface MapPilotGameProps {
  locale: Locale;
  seedDate?: string;
}

interface Copy {
  pilot: string;
  loading: string;
  empty: string;
  question: (date: string) => string;
  instructions: string;
  mapLabel: string;
  countryChoices: string;
  correct: string;
  incorrect: string;
  answerWas: string;
  yourAnswer: string;
  next: string;
  finish: string;
  complete: string;
  score: (correct: number, total: number) => string;
  restart: string;
  evidence: string;
  musicBrainz: string;
  scheduleNote: string;
  checkedAt: (date: string) => string;
  mapCredit: string;
  roundProgress: (current: number, total: number) => string;
}

// Equirectangular 1200x600 map cropped to 84°N–60°S. The polar rows hold no tour dates.
const MAP_VIEW_BOX = "0 20 1200 480";

const COPY: Record<Locale, Copy> = {
  "pt-BR": {
    pilot: "PILOTO · DEADLINE WORLD TOUR",
    loading: "Preparando a rodada de hoje…",
    empty: "Não há perguntas de mapa disponíveis.",
    question: (date) => `Em qual país a agenda oficial listou um show de BLACKPINK em ${date}?`,
    instructions: "Escolha um país destacado no mapa ou na lista.",
    mapLabel: "Mapa interativo de países. Use Tab e Enter para escolher uma área destacada.",
    countryChoices: "Países desta rodada",
    correct: "Resposta correta.",
    incorrect: "Essa não é a resposta.",
    answerWas: "País correto",
    yourAnswer: "Sua resposta",
    next: "Próxima data",
    finish: "Ver resultado",
    complete: "Rodada concluída",
    score: (correct, total) => `${correct} de ${total} respostas corretas.`,
    restart: "Jogar outra rodada",
    evidence: "Agenda oficial",
    musicBrainz: "MusicBrainz",
    scheduleNote: "A data aparece na agenda. Isso não confirma que o show aconteceu.",
    checkedAt: (date) => `Agenda conferida em ${date}.`,
    mapCredit: "Dados cartográficos: Natural Earth, domínio público.",
    roundProgress: (current, total) => `Pergunta ${current} de ${total}`,
  },
  en: {
    pilot: "PILOT · DEADLINE WORLD TOUR",
    loading: "Preparing today's round…",
    empty: "No map questions are available.",
    question: (date) => `Which country did the official schedule list for a BLACKPINK show on ${date}?`,
    instructions: "Choose a highlighted country on the map or in the list.",
    mapLabel: "Interactive country map. Use Tab and Enter to choose a highlighted area.",
    countryChoices: "Countries in this round",
    correct: "Correct answer.",
    incorrect: "That is not the answer.",
    answerWas: "Correct country",
    yourAnswer: "Your answer",
    next: "Next date",
    finish: "See result",
    complete: "Round complete",
    score: (correct, total) => `${correct} of ${total} answers correct.`,
    restart: "Play another round",
    evidence: "Official schedule",
    musicBrainz: "MusicBrainz",
    scheduleNote: "The date appears in the schedule. This does not confirm the show took place.",
    checkedAt: (date) => `Schedule checked on ${date}.`,
    mapCredit: "Map data: Natural Earth, public domain.",
    roundProgress: (current, total) => `Question ${current} of ${total}`,
  },
};

function formatDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function MapPilotGame({ locale, seedDate }: MapPilotGameProps) {
  const copy = COPY[locale];
  // The static build and the visitor's browser disagree on "today", so the
  // daily round is chosen only after hydration.
  const [roundSeed, setRoundSeed] = useState<string | null>(seedDate ?? null);
  useEffect(() => {
    if (roundSeed === null) setRoundSeed(new Date().toISOString().slice(0, 10));
  }, [roundSeed]);
  const round = useMemo(
    () => (roundSeed === null ? [] : selectMapPilotRound(mapPilotEvents, roundSeed)),
    [roundSeed],
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const nextButton = useRef<HTMLButtonElement>(null);
  const current = round[questionIndex] as MapPilotEvent | undefined;
  const countryByFeature = new Map(mapPilotCountries.map((country) => [country.map_feature_id, country]));
  const answerCountry = current ? countryByFeature.get(current.map_feature_id) : undefined;
  const selectedCountry = selectedFeature ? countryByFeature.get(selectedFeature) : undefined;
  const answerState = selectedFeature === null
    ? null
    : selectedFeature === current?.map_feature_id
      ? "correct"
      : "incorrect";

  // The next button appears in the sticky action bar, already in view, so
  // focusing it lets Enter advance without moving the page.
  useEffect(() => {
    if (answerState !== null) nextButton.current?.focus({ preventScroll: true });
  }, [answerState, questionIndex]);

  function chooseCountry(featureId: string) {
    if (!current || selectedFeature !== null || !countryByFeature.has(featureId)) return;
    setSelectedFeature(featureId);
    if (featureId === current.map_feature_id) setScore((value) => value + 1);
  }

  function nextQuestion() {
    if (questionIndex + 1 >= round.length) {
      setIsComplete(true);
      return;
    }
    setQuestionIndex((value) => value + 1);
    setSelectedFeature(null);
  }

  function restart() {
    setQuestionIndex(0);
    setSelectedFeature(null);
    setScore(0);
    setIsComplete(false);
  }

  if (roundSeed === null) {
    return <section class="map-pilot-state" role="status">{copy.loading}</section>;
  }

  if (round.length === 0) {
    return <section class="map-pilot-state" role="status">{copy.empty}</section>;
  }

  if (isComplete) {
    return (
      <section class="map-pilot-results" aria-labelledby="map-result-title">
        <p class="map-pilot-kicker">{copy.pilot}</p>
        <h2 id="map-result-title">{copy.complete}</h2>
        <p class="map-pilot-score">{copy.score(score, round.length)}</p>
        <button class="map-pilot-primary" type="button" onClick={restart}>{copy.restart}</button>
      </section>
    );
  }

  return (
    <section class="map-pilot-game" id="map-game" aria-labelledby="map-game-title">
      <header class="map-pilot-question-header">
        <p class="map-pilot-progress" aria-live="polite">{copy.roundProgress(questionIndex + 1, round.length)}</p>
        <h2 id="map-game-title">{copy.question(formatDate(current!.event_date, locale))}</h2>
      </header>

      <div class="map-pilot-layout">
        <div class="map-pilot-map-wrap">
          <svg
            class="map-pilot-world-map"
            viewBox={MAP_VIEW_BOX}
            role="group"
            aria-label={copy.mapLabel}
          >
            {mapPilotFeatures.map((feature) => {
              const isPlayable = countryByFeature.has(feature.id);
              const isSelected = selectedFeature === feature.id;
              const isCorrect = selectedFeature !== null && current?.map_feature_id === feature.id;
              return (
                <path
                  key={feature.id}
                  d={feature.path}
                  class={`map-pilot-feature ${isPlayable ? "is-playable" : ""} ${isSelected ? "is-selected" : ""} ${isCorrect ? "is-answer" : ""}`}
                  fillRule="evenodd"
                  role={isPlayable ? "button" : undefined}
                  tabIndex={isPlayable && selectedFeature === null ? 0 : -1}
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

        <div class="map-pilot-answers">
          <h3>{copy.countryChoices}</h3>
          <div class="map-pilot-country-list">
            {mapPilotCountries.map((country) => (
              <button
                key={country.map_feature_id}
                type="button"
                class={`map-pilot-country ${selectedFeature === country.map_feature_id ? "is-selected" : ""} ${selectedFeature !== null && country.map_feature_id === current!.map_feature_id ? "is-answer" : ""}`}
                disabled={selectedFeature !== null}
                onClick={() => chooseCountry(country.map_feature_id)}
                data-testid={`answer-country-${country.iso_3166_1}`}
              >
                {mapPilotCountryLabel(country, locale)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div class={`map-pilot-action-bar ${answerState ? `is-${answerState}` : ""}`} role="status" aria-live="polite">
        {answerState && current && answerCountry ? (
          <>
            <div class="map-pilot-feedback">
              <p class="map-pilot-feedback-title">{answerState === "correct" ? copy.correct : copy.incorrect}</p>
              <p>
                {selectedCountry && answerState === "incorrect" && <>{copy.yourAnswer}: <strong>{mapPilotCountryLabel(selectedCountry, locale)}</strong> · </>}
                {copy.answerWas}: <strong>{mapPilotCountryLabel(answerCountry, locale)}</strong>
              </p>
              <p class="map-pilot-evidence">
                <a href={current.source_url} target="_blank" rel="noreferrer">{copy.evidence}</a>
                <a href={current.musicbrainz_event_url} target="_blank" rel="noreferrer">{copy.musicBrainz}</a>
                <span>{copy.checkedAt(formatDate(current.source_checked_at, locale))} {copy.scheduleNote}</span>
              </p>
            </div>
            <button ref={nextButton} class="map-pilot-primary" type="button" onClick={nextQuestion}>
              {questionIndex + 1 === round.length ? copy.finish : copy.next}
            </button>
          </>
        ) : (
          <p class="map-pilot-instructions">{copy.instructions}</p>
        )}
      </div>
    </section>
  );
}
