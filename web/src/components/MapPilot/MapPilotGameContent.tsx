import { useGameAnalytics } from "../../lib/game-analytics";
import { useMemo, useRef, useState } from "preact/hooks";
import {
  mapPilotCountries,
  mapPilotCountryLabel,
  type MapPilotCountry,
  type MapPilotEvent,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useRecordMapMatch } from "./useRecordMapMatch";
import { formatMapDate } from "./MapPilotResult";
import type { MapPilotCopy } from "./map-pilot-copy";
import { MapPilotCountryList } from "./MapPilotControls";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { MapPilotMap } from "./MapPilotMap";
import { MapPilotActionBar } from "./MapPilotActionBar";
import { deriveMapTurn, type RoundState } from "./map-pilot-turn";
import { classes } from "./map-pilot-targets";
import { NEXT_GUARD_MS, useMapRoundActions } from "./useMapRoundActions";
import { useSaveMapRound } from "./useSaveMapRound";

export { NEXT_GUARD_MS, type RoundState };

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
  const nextButton = useRef<HTMLButtonElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);

  const turn = deriveMapTurn(game, round, listChoice, countryByFeature);
  const { isComplete, current, questionIndex, selectedFeature } = turn;
  const analytics = useGameAnalytics(
    {
      game: "map",
      locale,
      // The save is what remembers a replay.
      isDaily: () => !game.replay,
      outcome: turn.outcome,
    },
    isComplete,
    game.answers.length > 0,
  );
  const actions = useMapRoundActions({ game, setGame, round, playableFeatures, setListChoice, analytics });
  useRecordMapMatch(game.date, isComplete, turn.outcome === "win", game.replay === true);
  useSaveMapRound(game, round, isComplete);

  // Only what the player does in this visit moves focus; a round restored
  // from storage leaves focus where the page put it. Next appears in the
  // sticky action bar, already in view, so focusing it lets Enter advance
  // without moving the page.
  useFocusOnChange(nextButton, turn.answerState !== null && actions.playedHere.current, questionIndex);
  // At the end the result takes the bar, so focus its title to start reading there.
  useFocusOnChange(resultTitle, isComplete && actions.playedHere.current);

  const sortedCountries = useMemo(
    () => [...mapPilotCountries].sort((a, b) =>
      mapPilotCountryLabel(a, locale).localeCompare(mapPilotCountryLabel(b, locale), locale)),
    [locale],
  );
  const roundFeatures = new Set(round.map((event) => event.map_feature_id));

  return (
    <section
      class={classes("map-pilot-game", isComplete && "is-complete")}
      id="map-game"
      data-testid="game-board"
      aria-labelledby={isComplete ? undefined : "map-game-title"}
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
        highlightFeature={turn.highlightFeature}
        onSelect={actions.selectPending}
      />

      {current && (
        <MapPilotCountryList
          countries={sortedCountries}
          locale={locale}
          copy={copy}
          highlightFeature={turn.highlightFeature}
          selectedFeature={selectedFeature}
          answerFeature={current.map_feature_id}
          onPick={actions.selectPending}
        />
      )}

      <MapPilotActionBar
        locale={locale}
        copy={copy}
        messages={messages}
        game={game}
        round={round}
        turn={turn}
        countryByFeature={countryByFeature}
        sortedCountries={sortedCountries}
        listChoice={listChoice}
        setListChoice={setListChoice}
        actions={actions}
        nextButton={nextButton}
        resultTitle={resultTitle}
      />

      <ConfirmDialog
        isOpen={actions.confirmGiveUpOpen}
        title={messages.giveUpConfirmTitle}
        body={messages.giveUpConfirmBody}
        confirmLabel={messages.giveUpConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={actions.confirmGiveUp}
        onCancel={actions.closeGiveUpConfirm}
      />
    </section>
  );
}
