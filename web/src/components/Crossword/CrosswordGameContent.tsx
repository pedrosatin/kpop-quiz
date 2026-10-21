import { useRef, useState } from "preact/hooks";
import {
  cellKey,
  entryCellKey,
  entryCellKeys,
  normalizeCrosswordText,
  type CrosswordEntry,
  type CrosswordPuzzle,
} from "../../data/crossword";
import type { Messages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { CrosswordResult } from "./CrosswordResult";
import { useCrosswordGame } from "./useCrosswordGame";

export interface CrosswordGameContentProps {
  puzzle: CrosswordPuzzle;
  locale: Locale;
  messages: Messages;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export function CrosswordGameContent({ puzzle, locale, messages }: CrosswordGameContentProps) {
  const { values, status, finished, checks, correctWords, wrongCheck, setLetters, check, reveal, restart } =
    useCrosswordGame(puzzle, locale);
  const [active, setActive] = useState(0);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Only a round finished in this visit moves focus to the result; a round
  // restored from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, finished && playedHere.current);

  // n changes on every share, so the same message is announced again.
  const [shareNote, setShareNote] = useState<{ kind: "copied" | "shareFailed"; n: number } | null>(null);
  const shares = useRef(0);

  const direction = (entry: CrosswordEntry) => (entry.direction === "across" ? messages.crosswordAcross : messages.crosswordDown);
  const clueText = (entry: CrosswordEntry) =>
    messages.crosswordClue(entry.number, direction(entry), entry.clue[locale], entry.answer.length);
  const selected = puzzle.entries[active] ?? puzzle.entries[0]!;
  const selectedCells = entryCellKeys(selected);

  const select = (index: number) => {
    const input = inputs.current[entryCellKey(puzzle.entries[index]!, 0)];
    input?.focus();
    input?.select();
    setActive(index);
  };

  const onCheck = () => {
    playedHere.current = true;
    check();
  };
  const onReveal = () => {
    playedHere.current = true;
    reveal();
  };

  let message = null;
  let barState = "";
  if (finished) {
    if (shareNote?.kind === "copied") message = <p key={shareNote.n}>{messages.copiedToClipboard}</p>;
    else if (shareNote?.kind === "shareFailed") message = <p key={shareNote.n}>{messages.shareFailed}</p>;
    if (status === "won") barState = " is-correct";
  } else if (wrongCheck > 0) {
    message = <p key={wrongCheck} class="game-actions-title">{messages.crosswordWrong}</p>;
    barState = " is-incorrect";
  } else {
    message = <p class="game-actions-hint">{messages.crosswordHint}</p>;
  }

  return (
    <section
      id="crossword"
      tabIndex={-1}
      class="game-card game-card--wide crossword"
      data-testid="game-board"
      aria-label={messages.crosswordTitle}
    >
      <div class="game-layout">
        <div class="crossword-board">
          <p class="crossword-active-clue" data-testid="crossword-active-clue">
            {finished ? messages.crosswordBoardLabel : clueText(selected)}
          </p>
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
                      inputs.current[k] = el;
                    }}
                    aria-label={messages.crosswordCellLabel(
                      r + 1,
                      c + 1,
                      clues.map((e) => `${e.number} ${direction(e)}`).join("; "),
                    )}
                    value={finished ? cell.answer : values[k] ?? ""}
                    disabled={finished}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellcheck={false}
                    inputMode="text"
                    onFocus={(event) => {
                      event.currentTarget.select();
                      if (!clues.includes(selected)) setActive(puzzle.entries.indexOf(clues[0]!));
                    }}
                    onInput={(event) => {
                      const input = event.currentTarget;
                      const letters = normalizeCrosswordText(input.value);
                      const offset = selectedCells.indexOf(k);
                      const updates: Record<string, string> = {};
                      for (let i = 0; i < Math.max(1, letters.length) && offset + i < selectedCells.length; i++) {
                        updates[selectedCells[offset + i]!] = letters[i] ?? "";
                      }
                      // Keep the controlled value in step even when the state does not change.
                      input.value = updates[k] ?? "";
                      setLetters(updates);
                      if (letters) {
                        inputs.current[selectedCells[Math.min(offset + letters.length, selectedCells.length - 1)]!]?.focus();
                      }
                    }}
                    onKeyDown={(event) => {
                      const delta = ARROWS[event.key];
                      if (!delta) return;
                      event.preventDefault();
                      const [dr, dc] = delta;
                      for (let step = 1; step < Math.max(puzzle.rows, puzzle.cols); step++) {
                        const rr = r + dr * step;
                        const cc = c + dc * step;
                        if (rr < 0 || rr >= puzzle.rows || cc < 0 || cc >= puzzle.cols) break;
                        const next = inputs.current[cellKey(rr, cc)];
                        if (next) {
                          next.focus();
                          break;
                        }
                      }
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div class="game-layout-side">
          <div class="crossword-clues-panel">
            <h2 class="crossword-clues-title">{messages.crosswordCluesHeading}</h2>
            <ol class="crossword-clues">
              {puzzle.entries.map((entry, index) => (
                <li key={entry.qid}>
                  <button
                    class="btn btn-secondary"
                    type="button"
                    aria-pressed={!finished && active === index}
                    onClick={() => select(index)}
                    disabled={finished}
                  >
                    {clueText(entry)}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {/* The verdict and the controls while playing, the result at the
              end; the grid above never moves. */}
          <div class={`game-actions crossword-actions${barState}`}>
            {/* Mounted from the start so the first verdict is announced. At the
                end the result title takes its place, and this only announces
                the copy. */}
            <div
              class={`game-actions-message crossword-message${finished ? " visually-hidden" : ""}`}
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
            {finished ? (
              <CrosswordResult
                puzzle={puzzle}
                locale={locale}
                messages={messages}
                values={values}
                status={status}
                checks={checks}
                correctWords={correctWords}
                titleRef={resultTitle}
                onRestart={() => {
                  setShareNote(null);
                  setActive(0);
                  restart();
                }}
                onCopied={() => setShareNote({ kind: "copied", n: ++shares.current })}
                onShareFailed={() => setShareNote({ kind: "shareFailed", n: ++shares.current })}
              />
            ) : (
              <div class="crossword-controls">
                <button type="button" class="btn btn-primary" onClick={onCheck}>
                  {messages.crosswordCheck}
                </button>
                <button type="button" class="btn btn-secondary" onClick={onReveal}>
                  {messages.crosswordReveal}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
