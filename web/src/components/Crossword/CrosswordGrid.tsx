import type { RefObject } from "preact";
import {
  cellKey,
  entryCellKeys,
  normalizeCrosswordText,
  type CrosswordEntry,
  type CrosswordPuzzle,
} from "../../data/crossword";
import type { Messages } from "../../i18n/catalog";

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export type CrosswordInputs = Record<string, HTMLInputElement | null>;

interface CrosswordGridProps {
  puzzle: CrosswordPuzzle;
  messages: Messages;
  values: Readonly<Record<string, string>>;
  finished: boolean;
  selected: CrosswordEntry;
  inputs: RefObject<CrosswordInputs>;
  onSelectEntry: (index: number) => void;
  onLetters: (updates: Record<string, string>) => void;
}

/**
 * Letters typed in square `key` of the selected word: the first goes in the
 * square, the rest fill the next squares of the word (a paste or an IME
 * burst). An empty input clears the square.
 */
export function lettersFrom(raw: string, key: string, wordCells: readonly string[]): Record<string, string> {
  const letters = normalizeCrosswordText(raw);
  const offset = wordCells.indexOf(key);
  const updates: Record<string, string> = {};
  for (let i = 0; i < Math.max(1, letters.length) && offset + i < wordCells.length; i++) {
    updates[wordCells[offset + i]!] = letters[i] ?? "";
  }
  return updates;
}

/** The next square in a direction, skipping blocks; null at the edge. */
export function nextSquare(puzzle: CrosswordPuzzle, inputs: CrosswordInputs, row: number, col: number, [dr, dc]: [number, number]): HTMLInputElement | null {
  for (let step = 1; step < Math.max(puzzle.rows, puzzle.cols); step++) {
    const r = row + dr * step;
    const c = col + dc * step;
    if (r < 0 || r >= puzzle.rows || c < 0 || c >= puzzle.cols) return null;
    const next = inputs[cellKey(r, c)];
    if (next) return next;
  }
  return null;
}

export function CrosswordGrid({ puzzle, messages, values, finished, selected, inputs, onSelectEntry, onLetters }: CrosswordGridProps) {
  const selectedCells = entryCellKeys(selected);
  const direction = (entry: CrosswordEntry) => (entry.direction === "across" ? messages.crosswordAcross : messages.crosswordDown);

  const onInput = (key: string, input: HTMLInputElement) => {
    const typed = normalizeCrosswordText(input.value).length;
    const updates = lettersFrom(input.value, key, selectedCells);
    // Keep the controlled value in step even when the state does not change.
    input.value = updates[key] ?? "";
    onLetters(updates);
    if (!typed) return;
    const next = selectedCells[Math.min(selectedCells.indexOf(key) + typed, selectedCells.length - 1)]!;
    inputs.current?.[next]?.focus();
  };

  const onKeyDown = (row: number, col: number, event: KeyboardEvent) => {
    const delta = ARROWS[event.key];
    if (!delta) return;
    event.preventDefault();
    nextSquare(puzzle, inputs.current ?? {}, row, col, delta)?.focus();
  };

  return (
    <div
      class="crossword-grid"
      role="group"
      aria-label={messages.crosswordBoardLabel}
      style={{ "--crossword-rows": String(puzzle.rows), "--crossword-cols": String(puzzle.cols) }}
    >
      {Array.from({ length: puzzle.rows * puzzle.cols }, (_, index) => {
        const r = Math.floor(index / puzzle.cols);
        const c = index % puzzle.cols;
        const k = cellKey(r, c);
        const cell = puzzle.cells.find((x) => x.row === r && x.col === c);
        if (!cell) return <span key={k} class="crossword-block" aria-hidden="true" />;
        const start = puzzle.entries.find((e) => e.row === r && e.col === c);
        const clues = puzzle.entries.filter((e) => entryCellKeys(e).includes(k));
        const highlighted = !finished && selectedCells.includes(k);
        return (
          <label key={k} class={`crossword-cell${highlighted ? " selected" : ""}`}>
            {start && <span aria-hidden="true">{start.number}</span>}
            <input
              ref={(el) => {
                if (inputs.current) inputs.current[k] = el;
              }}
              aria-label={messages.crosswordCellLabel(r + 1, c + 1, clues.map((e) => `${e.number} ${direction(e)}`).join("; "))}
              value={finished ? cell.answer : values[k] ?? ""}
              disabled={finished}
              autoComplete="off"
              autoCapitalize="characters"
              spellcheck={false}
              inputMode="text"
              onFocus={(event) => {
                event.currentTarget.select();
                if (!clues.includes(selected)) onSelectEntry(puzzle.entries.indexOf(clues[0]!));
              }}
              onInput={(event) => onInput(k, event.currentTarget)}
              onKeyDown={(event) => onKeyDown(r, c, event)}
            />
          </label>
        );
      })}
    </div>
  );
}
