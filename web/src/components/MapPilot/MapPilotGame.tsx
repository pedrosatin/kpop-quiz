import { useEffect, useMemo, useState } from "preact/hooks";
import {
  mapPilotCountries,
  mapPilotEvents,
  selectMapPilotRound,
} from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import { dailyReferenceDate } from "../../data/daily-artifact";
import { loadMapPilotSave } from "./map-pilot-save";
import { MAP_PILOT_COPY } from "./map-pilot-copy";
import { MapPilotGameContent, NEXT_GUARD_MS, type RoundState } from "./MapPilotGameContent";

export { NEXT_GUARD_MS };

interface MapPilotGameProps {
  locale: Locale;
  seedDate?: string;
}

const playableFeatures = new Set(mapPilotCountries.map((country) => country.map_feature_id));
const countryByFeature = new Map(mapPilotCountries.map((country) => [country.map_feature_id, country]));

export function MapPilotGame({ locale, seedDate }: MapPilotGameProps) {
  const copy = MAP_PILOT_COPY[locale];
  // The static build and the visitor's browser disagree on "today", so the
  // daily round and its save are read only after hydration. The day turns at
  // midnight in Sao Paulo, like the other daily games.
  const [game, setGame] = useState<RoundState | null>(null);
  useEffect(() => {
    if (game !== null) return;
    const date = seedDate ?? dailyReferenceDate();
    const saved = loadMapPilotSave(date, selectMapPilotRound(mapPilotEvents, date), playableFeatures);
    setGame({ date, answers: saved?.answers ?? [], index: saved?.index ?? 0 });
  }, [game, seedDate]);
  const roundDate = game?.date ?? null;
  const round = useMemo(
    () => (roundDate === null ? [] : selectMapPilotRound(mapPilotEvents, roundDate)),
    [roundDate],
  );

  if (game === null) {
    return <section class="map-pilot-state" role="status">{copy.loading}</section>;
  }

  if (round.length === 0) {
    return <section class="map-pilot-state" role="status">{copy.empty}</section>;
  }

  return (
    <MapPilotGameContent
      locale={locale}
      copy={copy}
      game={game}
      setGame={setGame}
      round={round}
      playableFeatures={playableFeatures}
      countryByFeature={countryByFeature}
    />
  );
}
