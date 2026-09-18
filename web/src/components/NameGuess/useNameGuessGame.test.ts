import { renderHook, act } from "@testing-library/preact";
import { describe, expect, it, beforeEach } from "vitest";
import validPuzzleJson from "../../../public/data/name-guess.daily.json";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { useNameGuessGame } from "./useNameGuessGame";

const puzzle = validPuzzleJson as unknown as NameGuessPuzzle;

describe("useNameGuessGame hook", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with clean state", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    expect(result.current.guesses).toEqual([]);
    expect(result.current.feedbacks).toEqual([]);
    expect(result.current.currentInput).toBe("");
    expect(result.current.status).toBe("playing");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.highContrast).toBe(false);
  });

  it("handles adding and removing letters within word length limit", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    act(() => {
      result.current.addLetter("t");
      result.current.addLetter("W");
      result.current.addLetter("i");
    });
    expect(result.current.currentInput).toBe("TWI");

    act(() => {
      result.current.removeLetter();
    });
    expect(result.current.currentInput).toBe("TW");

    act(() => {
      result.current.addLetter("I");
      result.current.addLetter("C");
      result.current.addLetter("E");
      result.current.addLetter("X"); // Exceeds word length
    });
    expect(result.current.currentInput).toBe("TWICE");
  });

  it("rejects guesses with insufficient letters", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    act(() => {
      result.current.addLetter("T");
      result.current.addLetter("W");
    });

    act(() => {
      result.current.submitGuess();
    });

    expect(result.current.errorMessage).toBe("notEnoughLetters");
    expect(result.current.guesses).toEqual([]);
  });

  it("rejects guesses not in valid_guesses list", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    act(() => {
      // "ZZZZZ" is not in valid_guesses
      ["Z", "Z", "Z", "Z", "Z"].forEach((l) => result.current.addLetter(l));
    });

    act(() => {
      result.current.submitGuess();
    });

    expect(result.current.errorMessage).toBe("notInWordList");
    expect(result.current.guesses).toEqual([]);
  });

  it("accepts valid guess, records feedback, updates keyboard, and wins", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    act(() => {
      ["T", "W", "I", "C", "E"].forEach((l) => result.current.addLetter(l));
    });

    act(() => {
      result.current.submitGuess();
    });

    expect(result.current.guesses).toEqual(["TWICE"]);
    expect(result.current.status).toBe("won");
    expect(result.current.feedbacks[0]).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
    expect(result.current.keyStatuses.T).toBe("correct");
  });

  it("toggles high contrast mode and persists in localStorage", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    expect(result.current.highContrast).toBe(false);

    act(() => {
      result.current.toggleHighContrast();
    });
    expect(result.current.highContrast).toBe(true);

    const storageKey = `kpop_guess_state_${puzzle.puzzle_id}`;
    const raw = localStorage.getItem(storageKey);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).highContrast).toBe(true);

    act(() => {
      result.current.toggleHighContrast();
    });
    expect(result.current.highContrast).toBe(false);
  });

  it("resets game when resetGame is invoked", () => {
    const { result } = renderHook(() => useNameGuessGame(puzzle));

    act(() => {
      ["T", "W", "I", "C", "E"].forEach((l) => result.current.addLetter(l));
    });

    act(() => {
      result.current.submitGuess();
    });
    expect(result.current.status).toBe("won");

    act(() => {
      result.current.resetGame();
    });
    expect(result.current.status).toBe("playing");
    expect(result.current.guesses).toEqual([]);
  });
});
