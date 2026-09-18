import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
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

export function useNameGuessGame(puzzle: NameGuessPuzzle) {
  const storageKey = `kpop_guess_state_${puzzle.puzzle_id}`;

  const [guesses, setGuesses] = useState<string[]>([]);
  const [feedbacks, setFeedbacks] = useState<LetterStatus[][]>([]);
  const [currentInput, setCurrentInput] = useState<string>("");
  const [status, setStatus] = useState<GameStatus>("playing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highContrast, setHighContrast] = useState<boolean>(false);

  // Restore saved state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedGameState;
        if (Array.isArray(parsed.guesses) && Array.isArray(parsed.feedbacks)) {
          setGuesses(parsed.guesses);
          setFeedbacks(parsed.feedbacks);
          setStatus(parsed.status || "playing");
          setHighContrast(Boolean(parsed.highContrast));
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
    const timer = setTimeout(() => setErrorMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  const addLetter = useCallback((char: string) => {
    if (status !== "playing") return;
    const clean = char.toUpperCase();
    if (!/^[A-Z]$/.test(clean)) return;
    setErrorMessage(null);
    setCurrentInput((prev) => (prev.length < puzzle.word_length ? prev + clean : prev));
  }, [status, puzzle.word_length]);

  const removeLetter = useCallback(() => {
    if (status !== "playing") return;
    setErrorMessage(null);
    setCurrentInput((prev) => prev.slice(0, -1));
  }, [status]);

  const submitGuess = useCallback(() => {
    if (status !== "playing") return;
    if (currentInput.length !== puzzle.word_length) {
      setErrorMessage("notEnoughLetters");
      return;
    }
    if (!puzzle.valid_guesses.includes(currentInput)) {
      setErrorMessage("notInWordList");
      return;
    }

    const fb = computeFeedback(puzzle.target.normalized_name, currentInput);
    const nextGuesses = [...guesses, currentInput];
    const nextFeedbacks = [...feedbacks, fb];

    setGuesses(nextGuesses);
    setFeedbacks(nextFeedbacks);
    setCurrentInput("");

    if (currentInput === puzzle.target.normalized_name) {
      setStatus("won");
    } else if (nextGuesses.length >= puzzle.max_attempts) {
      setStatus("lost");
    }
  }, [status, currentInput, puzzle, guesses, feedbacks]);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => !prev);
  }, []);

  const resetGame = useCallback(() => {
    setGuesses([]);
    setFeedbacks([]);
    setCurrentInput("");
    setStatus("playing");
    setErrorMessage(null);
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
