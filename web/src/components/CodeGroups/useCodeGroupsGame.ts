import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CodeGroupsGuess, CodeGroupsPuzzle } from "../../data/code-groups";
import { scoreGuess } from "../../data/code-groups";
import { useGameAnalytics } from "../../lib/game-analytics";
import type { Locale } from "../../lib/quiz-types";

/**
 * What localStorage keeps of one daily round, under `kpop-code-<YYYY-MM-DD>`
 * (the puzzle date), following the map save: the QIDs of every submitted
 * guess in order and the current selection. The exact/misplaced counts are
 * recomputed from the secret, so a save never shows a count play did not
 * produce, and a save for another date is pruned instead of resumed.
 */
export interface CodeGroupsSave {
  history: string[][];
  selection: string[];
}

export function codeGroupsStorageKey(roundDate: string): string {
  return `kpop-code-${roundDate}`;
}

const ROUND_KEY = /^kpop-code-\d{4}-\d{2}-\d{2}$/;

/** Removes the saves of other days, so old rounds do not pile up in storage. */
function pruneCodeGroupsSaves(roundDate: string): void {
  try {
    const keep = codeGroupsStorageKey(roundDate);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key !== keep && ROUND_KEY.test(key)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {}
}

function isSymbolId(id: unknown, puzzle: CodeGroupsPuzzle): id is string {
  return typeof id === "string" && puzzle.symbols.some((s) => s.qid === id);
}

/**
 * Reads the save of this round and removes the saves of other days. A save
 * with a group outside the six symbols, a repeated group, more guesses than
 * the limit or a selection of the wrong shape is dropped, so a stale or
 * edited save never shows a round the player did not play.
 */
export function loadCodeGroupsSave(puzzle: CodeGroupsPuzzle): CodeGroupsSave | null {
  pruneCodeGroupsSaves(puzzle.reference_date);
  let saved: unknown;
  try {
    const raw = localStorage.getItem(codeGroupsStorageKey(puzzle.reference_date));
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return null;
  const { history, selection } = saved as Partial<CodeGroupsSave>;
  if (!Array.isArray(history) || history.length > puzzle.max_attempts) return null;
  for (const ids of history) {
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4) return null;
    if (!ids.every((id) => isSymbolId(id, puzzle))) return null;
  }
  if (!Array.isArray(selection) || selection.length !== 4) return null;
  if (history.length === puzzle.max_attempts && selection.some((id) => id !== "")) return null;
  if (!selection.every((id) => id === "" || isSymbolId(id, puzzle))) return null;
  return { history: history.map((ids) => [...ids]), selection: [...selection] };
}

export function storeCodeGroupsSave(puzzle: CodeGroupsPuzzle, save: CodeGroupsSave): void {
  try {
    localStorage.setItem(codeGroupsStorageKey(puzzle.reference_date), JSON.stringify(save));
  } catch {}
}

export function clearCodeGroupsSave(puzzle: CodeGroupsPuzzle): void {
  try {
    localStorage.removeItem(codeGroupsStorageKey(puzzle.reference_date));
  } catch {}
}

const EMPTY_SELECTION = ["", "", "", ""] as const;

export interface UseCodeGroupsGame {
  selection: string[];
  history: CodeGroupsGuess[];
  /** Whether every slot holds a distinct symbol. */
  selectionComplete: boolean;
  won: boolean;
  finished: boolean;
  selectValue: (index: number, qid: string) => void;
  submit: () => void;
  restart: () => void;
  /** String keys or composed messages for the live region; set on rejections and guesses. */
  feedback: { kind: "chooseAll" | "chooseDistinct" | "attempt"; attempt?: CodeGroupsGuess } | null;
}

export function useCodeGroupsGame(puzzle: CodeGroupsPuzzle, locale: Locale): UseCodeGroupsGame {
  const initialSave = useRef(loadCodeGroupsSave(puzzle));

  const [selection, setSelection] = useState<string[]>(() => {
    const saved = initialSave.current?.selection;
    return saved && saved.some((id) => id !== "") ? [...saved] : [...EMPTY_SELECTION];
  });
  const [history, setHistory] = useState<CodeGroupsGuess[]>(
    () => initialSave.current?.history.map((ids) => scoreGuess(puzzle, ids)) ?? [],
  );
  const [feedback, setFeedback] = useState<UseCodeGroupsGame["feedback"]>(null);

  const won = history.at(-1)?.exact === 4;
  const finished = won || history.length === puzzle.max_attempts;
  const analytics = useGameAnalytics({ game: "code", locale }, finished, history.length > 0);

  useEffect(() => {
    if (history.length === 0 && selection.every((id) => id === "")) return;
    storeCodeGroupsSave(puzzle, { history: history.map((guess) => guess.ids), selection });
  }, [puzzle, history, selection]);

  const selectValue = useCallback(
    (index: number, qid: string) => {
      if (finished) return;
      analytics.start();
      setFeedback(null);
      setSelection((prev) => {
        const next = [...prev];
        next[index] = qid;
        return next;
      });
    },
    [finished],
  );

  const submit = useCallback(() => {
    if (finished) return;
    if (selection.some((id) => !id)) {
      setFeedback({ kind: "chooseAll" });
      return;
    }
    if (new Set(selection).size !== 4) {
      setFeedback({ kind: "chooseDistinct" });
      return;
    }
    analytics.start();
    const guess = scoreGuess(puzzle, selection);
    setFeedback({ kind: "attempt", attempt: guess });
    setHistory((prev) => [...prev, guess]);
    setSelection([...EMPTY_SELECTION]);
  }, [finished, puzzle, selection]);

  const restart = useCallback(() => {
    analytics.reset();
    clearCodeGroupsSave(puzzle);
    setHistory([]);
    setSelection([...EMPTY_SELECTION]);
    setFeedback(null);
  }, [puzzle]);

  return {
    selection,
    history,
    selectionComplete: selection.every((id) => id) && new Set(selection).size === 4,
    won,
    finished,
    selectValue,
    submit,
    restart,
    feedback,
  };
}
