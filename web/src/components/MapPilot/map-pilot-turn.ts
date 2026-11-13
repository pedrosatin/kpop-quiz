import type { GameOutcome } from "../../lib/game-analytics";
import type { MapPilotCountry, MapPilotEvent } from "../../data/map-pilot";
import type { AnswerState } from "./map-pilot-feedback";

export interface RoundState {
  gaveUp?: boolean;
  replay?: boolean;
  date: string;
  answers: string[];
  index: number;
}

/** The Map shows only a score, so a win follows the Quiz rule: at least half right. */
export function mapRoundOutcome(round: MapPilotEvent[], answers: string[], gaveUp: boolean): GameOutcome {
  if (gaveUp || answers.length < round.length) return "give_up";
  const correct = round.filter((event, index) => answers[index] === event.map_feature_id).length;
  return correct >= Math.ceil(round.length / 2) ? "win" : "loss";
}

/** The date on screen and what the player did with it, read from the save and the pending pick. */
export interface MapTurn {
  questionIndex: number;
  isComplete: boolean;
  outcome: GameOutcome | null;
  /** The date on screen; undefined once the round is over. */
  current: MapPilotEvent | undefined;
  /** The committed answer for the date on screen. */
  selectedFeature: string | null;
  /** The committed answer, else the pending pick. */
  highlightFeature: string | null;
  answerCountry: MapPilotCountry | undefined;
  selectedCountry: MapPilotCountry | undefined;
  answerState: AnswerState;
}

function answerStateOf(current: MapPilotEvent | undefined, selectedFeature: string | null): AnswerState {
  if (selectedFeature === null || !current) return null;
  return selectedFeature === current.map_feature_id ? "correct" : "incorrect";
}

export function deriveMapTurn(
  game: RoundState,
  round: MapPilotEvent[],
  listChoice: string,
  countryByFeature: Map<string, MapPilotCountry>,
): MapTurn {
  const questionIndex = game.index;
  const isComplete = round.length > 0 && questionIndex >= round.length;
  const current = isComplete ? undefined : round[questionIndex];
  const selectedFeature = game.answers.length > questionIndex ? game.answers[questionIndex]! : null;
  return {
    questionIndex,
    isComplete,
    outcome: isComplete ? mapRoundOutcome(round, game.answers, game.gaveUp === true) : null,
    current,
    selectedFeature,
    // Pending pick from map/list/select; only Responder commits it into answers.
    highlightFeature: selectedFeature ?? (listChoice || null),
    answerCountry: current && countryByFeature.get(current.map_feature_id),
    selectedCountry: selectedFeature === null ? undefined : countryByFeature.get(selectedFeature),
    answerState: answerStateOf(current, selectedFeature),
  };
}
