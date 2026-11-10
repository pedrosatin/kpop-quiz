import { useGameAnalytics } from "../../lib/game-analytics";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ConnectionsPuzzle, Locale } from "../../lib/quiz-types";
import { isGameMatchRecorded } from "../../lib/player-stats";
import type { ConnectionsGameStatus, ConnectionsStoredState, GuessResult } from "./types";
import { connectionsMatchId } from "./useRecordConnectionsMatch";

const MAX_MISTAKES = 4;

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

export function loadSavedState(key: string | null): ConnectionsStoredState | null {
  if (!key) return null;
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    const p: ConnectionsStoredState = JSON.parse(saved);
    if (
      !Array.isArray(p.boardItemIds) ||
      !Array.isArray(p.solvedCategoryIds) ||
      !Array.isArray(p.guessHistory) ||
      typeof p.mistakesRemaining !== "number"
    ) {
      return null;
    }
    // A finished game keeps an empty board; one in progress never has one.
    // A win has all four categories solved. Anything else is discarded, so a
    // broken save never shows a result the player did not reach.
    if (p.gameStatus === "in_progress") return p.boardItemIds.length > 0 ? p : null;
    if (p.gameStatus !== "won" && p.gameStatus !== "lost") return null;
    if (p.boardItemIds.length > 0) return null;
    if (p.gameStatus === "won" && new Set(p.solvedCategoryIds).size !== 4) return null;
    return p;
  } catch {}
  return null;
}

export function useConnectionsGame(puzzle: ConnectionsPuzzle | null, _locale: Locale = "pt-BR") {
  const storageKey = puzzle ? `kpop-connections-${puzzle.puzzle_id}` : null;
  const initialSaved = useRef(loadSavedState(storageKey));

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [solvedCategoryIds, setSolvedCategoryIds] = useState<string[]>(
    () => initialSaved.current?.solvedCategoryIds || []
  );
  const [mistakesRemaining, setMistakesRemaining] = useState<number>(
    () => initialSaved.current?.mistakesRemaining ?? MAX_MISTAKES
  );
  const [guessHistory, setGuessHistory] = useState<string[][]>(
    () => initialSaved.current?.guessHistory || []
  );
  const [gameStatus, setGameStatus] = useState<ConnectionsGameStatus>(
    () => initialSaved.current?.gameStatus || "in_progress"
  );
  const [boardItemIds, setBoardItemIds] = useState<string[]>(() => {
    if (initialSaved.current?.boardItemIds) return initialSaved.current.boardItemIds;
    return puzzle ? shuffleArray(puzzle.items.map((i) => i.id)) : [];
  });

  const analytics = useGameAnalytics(
    {
      game: "connections",
      locale: _locale,
      isDaily: () => puzzle !== null && !isGameMatchRecorded("connections", connectionsMatchId(puzzle)),
      // Only a give-up ends the game with mistakes left.
      outcome: gameStatus === "won" ? "win" : gameStatus === "lost" ? (mistakesRemaining > 0 ? "give_up" : "loss") : null,
    },
    gameStatus !== "in_progress",
    guessHistory.length > 0,
  );

  // Sync to localStorage
  useEffect(() => {
    if (!storageKey || !puzzle) return;
    try {
      const stateToStore: ConnectionsStoredState = {
        solvedCategoryIds, mistakesRemaining, guessHistory, gameStatus, boardItemIds,
      };
      localStorage.setItem(storageKey, JSON.stringify(stateToStore));
    } catch {}
  }, [storageKey, puzzle, solvedCategoryIds, mistakesRemaining, guessHistory, gameStatus, boardItemIds]);

  const toggleSelectItem = useCallback((id: string) => {
    if (gameStatus !== "in_progress") return;
    analytics.start();
    setSelectedItemIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      return prev.length < 4 ? [...prev, id] : prev;
    });
  }, [gameStatus]);

  const clearSelection = useCallback(() => {
    setSelectedItemIds([]);
  }, []);

  const shuffleItems = useCallback(() => {
    setBoardItemIds((prev) => shuffleArray(prev));
  }, []);

  const submitGuess = useCallback((): GuessResult => {
    if (!puzzle || gameStatus !== "in_progress" || selectedItemIds.length !== 4) {
      return { success: false, oneAway: false };
    }
    const currentSorted = [...selectedItemIds].sort();
    const isRepeat = guessHistory.some((g) => {
      const gSorted = [...g].sort();
      return gSorted.every((id, idx) => id === currentSorted[idx]);
    });

    if (isRepeat) {
      return { success: false, oneAway: false, alreadyGuessed: true };
    }

    setGuessHistory((prev) => [...prev, selectedItemIds]);

    const matched = puzzle.categories.find((cat) =>
      !solvedCategoryIds.includes(cat.id) &&
      cat.item_ids.length === 4 &&
      cat.item_ids.every((id) => selectedItemIds.includes(id))
    );

    if (matched) {
      const newSolved = [...solvedCategoryIds, matched.id];
      setSolvedCategoryIds(newSolved);
      setBoardItemIds((prev) => prev.filter((id) => !matched.item_ids.includes(id)));
      setSelectedItemIds([]);
      if (newSolved.length === 4) setGameStatus("won");
      return { success: true, oneAway: false, category: matched };
    }

    const oneAway = puzzle.categories.some((cat) =>
      !solvedCategoryIds.includes(cat.id) &&
      selectedItemIds.filter((id) => cat.item_ids.includes(id)).length === 3
    );

    const nextMistakes = mistakesRemaining - 1;
    setMistakesRemaining(nextMistakes);

    if (nextMistakes <= 0) {
      setGameStatus("lost");
      setSolvedCategoryIds(puzzle.categories.map((c) => c.id));
      setBoardItemIds([]);
      setSelectedItemIds([]);
    }

    return { success: false, oneAway };
  }, [puzzle, gameStatus, selectedItemIds, guessHistory, solvedCategoryIds, mistakesRemaining]);

  const giveUp = useCallback(() => {
    if (!puzzle || gameStatus !== "in_progress") return;
    analytics.start();
    setGameStatus("lost");
    setSolvedCategoryIds(puzzle.categories.map((c) => c.id));
    setBoardItemIds([]);
    setSelectedItemIds([]);
  }, [puzzle, gameStatus]);

  const restartGame = useCallback(() => {
    analytics.reset();
    if (!puzzle) return;
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
    setBoardItemIds(shuffleArray(puzzle.items.map((i) => i.id)));
    setSolvedCategoryIds([]);
    setMistakesRemaining(MAX_MISTAKES);
    setGuessHistory([]);
    setGameStatus("in_progress");
    setSelectedItemIds([]);
  }, [puzzle, storageKey]);

  return {
    selectedItemIds, solvedCategoryIds, mistakesRemaining, guessHistory,
    gameStatus, boardItemIds,
    toggleSelectItem, clearSelection, shuffleItems, submitGuess, giveUp, restartGame,
  };
}
