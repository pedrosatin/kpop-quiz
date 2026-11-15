import type { CodeGroupsGuess, CodeGroupsPuzzle } from "../../data/code-groups";
import { scoreGuess } from "../../data/code-groups";
import type { GameOutcome } from "../../lib/game-analytics";

export const EMPTY_SELECTION = ["", "", "", ""] as const;

/** Why a guess was refused without spending an attempt. */
export type CodeGroupsRejection = "chooseAll" | "chooseDistinct" | "alreadyGuessed";

/** The last rejection or guess, shown in the live region. */
export type CodeGroupsFeedback = { kind: CodeGroupsRejection | "attempt"; attempt?: CodeGroupsGuess } | null;

/** The slots a round opens with: the saved pick, or empty slots when the save picked nothing. */
export function startingSelection(saved: readonly string[] | undefined): string[] {
  return saved && saved.some((id) => id !== "") ? [...saved] : [...EMPTY_SELECTION];
}

/** The saved guesses scored again against the secret, so a save never carries its own counts. */
export function startingHistory(puzzle: CodeGroupsPuzzle, saved: readonly string[][] | undefined): CodeGroupsGuess[] {
  return saved?.map((ids) => scoreGuess(puzzle, ids)) ?? [];
}

export function isRoundWon(history: readonly CodeGroupsGuess[]): boolean {
  return history.at(-1)?.exact === 4;
}

/** The round ends with the code or out of attempts; it has no give-up. */
export function isRoundFinished(puzzle: CodeGroupsPuzzle, history: readonly CodeGroupsGuess[]): boolean {
  return isRoundWon(history) || history.length === puzzle.max_attempts;
}

export function roundOutcome(won: boolean, finished: boolean): GameOutcome | null {
  if (!finished) return null;
  return won ? "win" : "loss";
}

/** Whether the round has anything to save: a guess sent or a slot picked. */
export function hasRoundProgress(history: readonly CodeGroupsGuess[], selection: readonly string[]): boolean {
  return history.length > 0 || selection.some((id) => id !== "");
}

/** `selection` with slot `index` holding `qid`. */
export function withSlot(selection: readonly string[], index: number, qid: string): string[] {
  const next = [...selection];
  next[index] = qid;
  return next;
}

/** Whether `selection` repeats, in the same order, a guess already sent. */
export function isRepeatedGuess(history: readonly CodeGroupsGuess[], selection: readonly string[]): boolean {
  return history.some((guess) => guess.ids.every((id, index) => id === selection[index]));
}

/** Whether every slot holds a distinct symbol. */
export function isSelectionComplete(selection: readonly string[]): boolean {
  return selection.every((id) => id) && new Set(selection).size === 4;
}

/**
 * Why `selection` cannot be sent, checked in this order: an empty slot, a
 * repeated group, then a guess already sent, since it cannot tell anything new.
 * Null when the guess may spend an attempt.
 */
export function guessRejection(history: readonly CodeGroupsGuess[], selection: readonly string[]): CodeGroupsRejection | null {
  if (selection.some((id) => !id)) return "chooseAll";
  if (new Set(selection).size !== 4) return "chooseDistinct";
  if (isRepeatedGuess(history, selection)) return "alreadyGuessed";
  return null;
}

/** Whether `guess`, sent after `sentBefore` guesses, ends the round. */
export function guessEndsRound(puzzle: CodeGroupsPuzzle, guess: CodeGroupsGuess, sentBefore: number): boolean {
  return guess.exact === 4 || sentBefore + 1 === puzzle.max_attempts;
}
