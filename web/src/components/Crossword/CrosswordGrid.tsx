import type { RefObject } from "preact";
import { useRef } from "preact/hooks";
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
  /** Squares ("row:col") the last check found wrong or empty. */
  wrongCells: ReadonlySet<string>;
  /** Keeps the last square that had focus, so a check can return to it. */
  cursor: RefObject<string | null>;
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

/** Account for overlays that native focus scrolling cannot see. */
function keepSquareVisible(input: HTMLInputElement): void {
  requestAnimationFrame(() => {
    if (document.activeElement !== input) return;
    const rect = input.getBoundingClientRect();
    if (!rect.width) return;
    let bottom = window.innerHeight;
    const overlays = [document.querySelector('.consent-banner'), input.closest('.crossword')?.querySelector('.crossword-actions')];
    for (const overlay of overlays) {
      if (!overlay || !['fixed', 'sticky'].includes(getComputedStyle(overlay).position)) continue;
      const obstruction = overlay.getBoundingClientRect();
      if (obstruction.left < rect.right && obstruction.right > rect.left) bottom = Math.min(bottom, obstruction.top);
    }
    const offset = Math.max(0, rect.bottom - bottom + 8) || Math.min(0, rect.top - 8);
    if (offset) window.scrollBy({ top: offset, behavior: 'instant' });
  });
}

function eraseSquare(key: string, input: HTMLInputElement, wordCells: readonly string[], inputs: CrosswordInputs, onLetters: CrosswordGridProps['onLetters']): void {
  const target = input.value ? key : wordCells[wordCells.indexOf(key) - 1];
  if (!target) return;
  onLetters({ [target]: '' });
  const square = inputs[target]!;
  // Clear immediately so repeated native keydowns see the updated value.
  square.value = '';
  square.focus();
  keepSquareVisible(square);
}

/**
 * A second tap or click on the square that already has focus switches to the
 * other word through it, as in the NYT Mini. The press records whether the
 * square had focus before it, because the click comes after the press focused it.
 */
export function useDirectionToggle(puzzle: CrosswordPuzzle, selected: CrosswordEntry, onSelectEntry: (index: number) => void) {
  const focusedAtPress = useRef<string | null>(null);
  const press = (key: string, input: HTMLInputElement | null) => {
    focusedAtPress.current = input !== null && document.activeElement === input ? key : null;
  };
  const click = (key: string, clues: readonly CrosswordEntry[]) => {
    const again = focusedAtPress.current === key;
    focusedAtPress.current = null;
    const other = otherWord(clues, selected);
    if (again && other) onSelectEntry(puzzle.entries.indexOf(other));
  };
  return { press, click };
}

/** The other word through a crossing square, or null outside a crossing. */
export function otherWord(clues: readonly CrosswordEntry[], selected: CrosswordEntry): CrosswordEntry | null {
  if (clues.length < 2 || !clues.includes(selected)) return null;
  return clues.find((entry) => entry !== selected) ?? null;
}

export function CrosswordGrid({ puzzle, messages, values, finished, selected, inputs, wrongCells, cursor, onSelectEntry, onLetters }: CrosswordGridProps) {
  const selectedCells = entryCellKeys(selected);
  const toggle = useDirectionToggle(puzzle, selected, onSelectEntry);
  const direction = (entry: CrosswordEntry) => (entry.direction === "across" ? messages.crosswordAcross : messages.crosswordDown);

  const onInput = (key: string, input: HTMLInputElement) => {
    const typed = normalizeCrosswordText(input.value).length;
    const updates = lettersFrom(input.value, key, selectedCells);
    // Keep the controlled value in step even when the state does not change.
    input.value = updates[key] ?? "";
    onLetters(updates);
    keepSquareVisible(input);
    if (!typed) return;
    const next = selectedCells[Math.min(selectedCells.indexOf(key) + typed, selectedCells.length - 1)]!;
    inputs.current?.[next]?.focus();
  };

  const onKeyDown = (row: number, col: number, event: KeyboardEvent) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      eraseSquare(cellKey(row, col), event.currentTarget as HTMLInputElement, selectedCells, inputs.current!, onLetters);
      return;
    }
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
        const clues = puzzle.entries.filter((e) => entryCellKeys(e).includes(k));
        return (
          <CrosswordSquare
            key={k}
            number={puzzle.entries.find((e) => e.row === r && e.col === c)?.number}
            label={messages.crosswordCellLabel(r + 1, c + 1, clues.map((e) => `${e.number} ${direction(e)}`).join("; "))}
            value={finished ? cell.answer : values[k] ?? ""}
            finished={finished}
            highlighted={selectedCells.includes(k)}
            wrong={wrongCells.has(k)}
            inputRef={(el) => {
              if (inputs.current) inputs.current[k] = el;
            }}
            onPress={() => toggle.press(k, inputs.current?.[k] ?? null)}
            onFocus={(input) => {
              cursor.current = k;
              input.select();
              if (!clues.includes(selected)) onSelectEntry(puzzle.entries.indexOf(clues[0]!));
              keepSquareVisible(input);
            }}
            onClick={() => toggle.click(k, clues)}
            onInput={(input) => onInput(k, input)}
            onKeyDown={(event) => onKeyDown(r, c, event)}
          />
        );
      })}
    </div>
  );
}

interface CrosswordSquareProps {
  number: number | undefined;
  label: string;
  value: string;
  finished: boolean;
  highlighted: boolean;
  wrong: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onPress: () => void;
  onFocus: (input: HTMLInputElement) => void;
  onClick: () => void;
  onInput: (input: HTMLInputElement) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/** "selected" for the squares of the chosen word, "is-wrong" for a square the last check marked. */
export function squareClass(finished: boolean, highlighted: boolean, wrong: boolean): string {
  if (finished) return "crossword-cell";
  return `crossword-cell${highlighted ? " selected" : ""}${wrong ? " is-wrong" : ""}`;
}

/**
 * One letter square. The press listens on the label, so a press on the
 * border counts too; the label forwards its click to the input.
 */
function CrosswordSquare(props: CrosswordSquareProps) {
  const wrong = props.wrong && !props.finished;
  return (
    <label class={squareClass(props.finished, props.highlighted, props.wrong)} onPointerDown={props.onPress}>
      {props.number !== undefined && <span aria-hidden="true">{props.number}</span>}
      <input
        ref={props.inputRef}
        aria-label={props.label}
        value={props.value}
        disabled={props.finished}
        aria-invalid={wrong ? "true" : undefined}
        autoComplete="off"
        autoCapitalize="characters"
        spellcheck={false}
        inputMode="text"
        onFocus={(event) => props.onFocus(event.currentTarget)}
        onClick={props.onClick}
        onInput={(event) => props.onInput(event.currentTarget)}
        onKeyDown={props.onKeyDown}
      />
    </label>
  );
}
