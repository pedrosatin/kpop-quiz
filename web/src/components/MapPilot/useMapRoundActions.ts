import { useRef, useState } from "preact/hooks";
import type { MapPilotEvent } from "../../data/map-pilot";
import type { RoundState } from "./map-pilot-turn";

/** How long Next ignores activation after it replaces the answer controls. */
export const NEXT_GUARD_MS = 300;

export interface MapRoundActionsInput {
  game: RoundState;
  setGame: (game: RoundState) => void;
  round: MapPilotEvent[];
  playableFeatures: Set<string>;
  setListChoice: (featureId: string) => void;
  analytics: { start: () => void };
}

export interface MapRoundActions {
  /** Answer pressed with no country picked: the live region says so. */
  pickPrompt: number;
  promptPick: () => void;
  clearPickPrompt: () => void;
  /** The player acted in this visit; a round restored from storage did not. */
  playedHere: { current: boolean };
  selectPending: (featureId: string) => void;
  submitAnswer: (featureId: string) => void;
  nextQuestion: () => void;
  confirmGiveUpOpen: boolean;
  requestGiveUp: () => void;
  confirmGiveUp: () => void;
  closeGiveUpConfirm: () => void;
}

/** What the player does with a round: pick, answer, go on or give up. */
export function useMapRoundActions({
  game,
  setGame,
  round,
  playableFeatures,
  setListChoice,
  analytics,
}: MapRoundActionsInput): MapRoundActions {
  const [pickPrompt, setPickPrompt] = useState(0);
  const playedHere = useRef(false);
  const answeredAt = useRef(-Infinity);
  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const confirmGiveUpOpenRef = useRef(false);
  const isComplete = round.length > 0 && game.index >= round.length;

  /** A country can be picked while the date on screen has no answer. */
  function canPick(featureId: string): boolean {
    return !isComplete && game.answers.length <= game.index && playableFeatures.has(featureId);
  }

  /** Every action of the player starts the round and clears the pending pick. */
  function act() {
    analytics.start();
    playedHere.current = true;
    setPickPrompt(0);
  }

  function selectPending(featureId: string) {
    if (!canPick(featureId)) return;
    act();
    setListChoice(featureId);
  }

  function submitAnswer(featureId: string) {
    if (!canPick(featureId)) return;
    act();
    answeredAt.current = performance.now();
    setListChoice("");
    setGame({ ...game, answers: [...game.answers, featureId] });
  }

  function nextQuestion() {
    // Next takes the place of the answer controls: the second tap of a double
    // tap, or a second Enter, meant for the answer must not skip the verdict.
    if (performance.now() - answeredAt.current < NEXT_GUARD_MS) return;
    act();
    setListChoice("");
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
    act();
    setListChoice("");
    setGame({ ...game, index: round.length, gaveUp: true });
  }

  return {
    pickPrompt,
    promptPick: () => setPickPrompt((value) => value + 1),
    clearPickPrompt: () => setPickPrompt(0),
    playedHere,
    selectPending,
    submitAnswer,
    nextQuestion,
    confirmGiveUpOpen,
    requestGiveUp,
    confirmGiveUp,
    closeGiveUpConfirm,
  };
}
