import { useCallback, useEffect, useMemo, useReducer } from "preact/hooks";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import type { GameStatus, LetterStatus } from "./types";

export function computeFeedback(target: string, guess: string): LetterStatus[] {
  const n = target.length;
  const result: (LetterStatus | null)[] = new Array(n).fill(null);
  const counts: Record<string, number> = {};

  for (const char of target) {
    counts[char] = (counts[char] || 0) + 1;
  }

  // Pass 1: exact matches
  for (let i = 0; i < n; i++) {
    if (guess[i] === target[i]) {
      result[i] = "correct";
      counts[guess[i]!] = (counts[guess[i]!] || 1) - 1;
    }
  }

  // Pass 2: present or absent
  for (let i = 0; i < n; i++) {
    if (result[i] === null) {
      const char = guess[i]!;
      if (counts[char] && counts[char] > 0) {
        result[i] = "present";
        counts[char] -= 1;
      } else {
        result[i] = "absent";
      }
    }
  }

  return result as LetterStatus[];
}

interface SavedGameState {
  guesses: string[];
  feedbacks: LetterStatus[][];
  status: GameStatus;
  highContrast: boolean;
}

type ErrorCode = "notEnoughLetters" | "notInWordList";

interface GameState {
  guesses: string[];
  feedbacks: LetterStatus[][];
  currentInput: string;
  status: GameStatus;
  errorMessage: ErrorCode | null;
  highContrast: boolean;
}

type GameAction =
  | { type: "addLetter"; char: string; puzzle: NameGuessPuzzle }
  | { type: "removeLetter" }
  | { type: "submitGuess"; puzzle: NameGuessPuzzle }
  | { type: "toggleHighContrast" }
  | { type: "clearError" }
  | { type: "reset" }
  | { type: "restore"; saved: SavedGameState };

const INITIAL_STATE: GameState = {
  guesses: [],
  feedbacks: [],
  currentInput: "",
  status: "playing",
  errorMessage: null,
  highContrast: false,
};

// Every input goes through this reducer, so each key sees the state left by the
// previous one even when several keys arrive before the component re-renders.
function nameGuessReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "addLetter": {
      if (state.status !== "playing") return state;
      const clean = action.char.toUpperCase();
      if (!/^[A-Z]$/.test(clean)) return state;
      const currentInput =
        state.currentInput.length < action.puzzle.word_length
          ? state.currentInput + clean
          : state.currentInput;
      return { ...state, currentInput, errorMessage: null };
    }
    case "removeLetter":
      if (state.status !== "playing") return state;
      return { ...state, currentInput: state.currentInput.slice(0, -1), errorMessage: null };
    case "submitGuess": {
      if (state.status !== "playing") return state;
      const { puzzle } = action;
      const guess = state.currentInput;
      if (guess.length !== puzzle.word_length) {
        return { ...state, errorMessage: "notEnoughLetters" };
      }
      if (!puzzle.valid_guesses.includes(guess)) {
        return { ...state, errorMessage: "notInWordList" };
      }
      const guesses = [...state.guesses, guess];
      const feedbacks = [...state.feedbacks, computeFeedback(puzzle.target.normalized_name, guess)];
      let status: GameStatus = "playing";
      if (guess === puzzle.target.normalized_name) {
        status = "won";
      } else if (guesses.length >= puzzle.max_attempts) {
        status = "lost";
      }
      return { ...state, guesses, feedbacks, currentInput: "", status };
    }
    case "toggleHighContrast":
      return { ...state, highContrast: !state.highContrast };
    case "clearError":
      return state.errorMessage === null ? state : { ...state, errorMessage: null };
    case "reset":
      return {
        ...state,
        guesses: [],
        feedbacks: [],
        currentInput: "",
        status: "playing",
        errorMessage: null,
      };
    case "restore":
      return {
        ...state,
        guesses: action.saved.guesses,
        feedbacks: action.saved.feedbacks,
        status: action.saved.status || "playing",
        highContrast: Boolean(action.saved.highContrast),
      };
  }
}

export function useNameGuessGame(puzzle: NameGuessPuzzle) {
  const storageKey = `kpop_guess_state_${puzzle.puzzle_id}`;

  const [state, dispatch] = useReducer(nameGuessReducer, INITIAL_STATE);
  const { guesses, feedbacks, currentInput, status, errorMessage, highContrast } = state;

  // Restore saved state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedGameState;
        if (Array.isArray(parsed.guesses) && Array.isArray(parsed.feedbacks)) {
          dispatch({ type: "restore", saved: parsed });
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, [storageKey]);

  // Save state on change
  useEffect(() => {
    if (guesses.length === 0 && !highContrast) return;
    try {
      const payload: SavedGameState = { guesses, feedbacks, status, highContrast };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
  }, [guesses, feedbacks, status, highContrast, storageKey]);

  // Clear transient error message after delay
  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => dispatch({ type: "clearError" }), 2500);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  const addLetter = useCallback(
    (char: string) => dispatch({ type: "addLetter", char, puzzle }),
    [puzzle]
  );

  const removeLetter = useCallback(() => dispatch({ type: "removeLetter" }), []);

  const submitGuess = useCallback(() => dispatch({ type: "submitGuess", puzzle }), [puzzle]);

  const toggleHighContrast = useCallback(() => dispatch({ type: "toggleHighContrast" }), []);

  const resetGame = useCallback(() => {
    dispatch({ type: "reset" });
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
  }, [storageKey]);

  // Key status mapping for virtual keyboard
  const keyStatuses = useMemo(() => {
    const map: Record<string, LetterStatus> = {};
    for (let g = 0; g < guesses.length; g++) {
      const word = guesses[g]!;
      const fb = feedbacks[g]!;
      for (let i = 0; i < word.length; i++) {
        const letter = word[i]!;
        const current = map[letter];
        const status = fb[i]!;
        if (status === "correct") {
          map[letter] = "correct";
        } else if (status === "present" && current !== "correct") {
          map[letter] = "present";
        } else if (!current) {
          map[letter] = status;
        }
      }
    }
    return map;
  }, [guesses, feedbacks]);

  return {
    guesses,
    feedbacks,
    currentInput,
    status,
    errorMessage,
    highContrast,
    keyStatuses,
    addLetter,
    removeLetter,
    submitGuess,
    toggleHighContrast,
    resetGame,
  };
}
