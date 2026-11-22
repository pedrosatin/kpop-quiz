import type { GameOutcome } from "../../lib/game-analytics";
import type { MapPilotCountry, MapPilotEvent } from "../../data/map-pilot";
import type { DailyRound } from "../../lib/use-record-daily-match";
import type { AnswerState } from "./map-pilot-feedback";

export interface RoundState {
  gaveUp?: boolean;
  replay?: boolean;
  date: string;
  answers: string[];
  index: number;
}

export function mapMatchId(roundDate: string): string {
  return `map-${roundDate}`;
}

/** Round to count; a replay is free play and returns null. */
export function mapDailyRound(roundDate: string, isReplay: boolean): DailyRound | null {
  return isReplay ? null : { matchId: mapMatchId(roundDate), date: roundDate };
}

/** Whether the answer given for a date is its country. */
export function isRightAnswer(event: MapPilotEvent, answer: string | undefined): boolean {
  return answer === event.map_feature_id;
}

/** How many dates of the round have the right answer; a date with no answer is wrong. */
export function countRightAnswers(round: readonly MapPilotEvent[], answers: readonly string[]): number {
  return round.filter((event, index) => isRightAnswer(event, answers[index])).length;
}

/** The Map shows only a score, so a win follows the Quiz rule: at least half right. */
export function mapRoundOutcome(round: MapPilotEvent[], answers: string[], gaveUp: boolean): GameOutcome {
  if (gaveUp || answers.length < round.length) return "give_up";
  return countRightAnswers(round, answers) >= Math.ceil(round.length / 2) ? "win" : "loss";
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
    highlightFeature: selectedFeature ?? (listChoice || null),
    answerCountry: current && countryByFeature.get(current.map_feature_id),
    selectedCountry: selectedFeature === null ? undefined : countryByFeature.get(selectedFeature),
    answerState: answerStateOf(current, selectedFeature),
  };
}
