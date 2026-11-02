import type { JSX } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";
import { entryCellKey, type CrosswordPuzzle } from "../../data/crossword";
import type { Messages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import type { CrosswordStatus } from "./crossword-save";
import { CrosswordClues, clueText } from "./CrosswordClues";
import { CrosswordGrid, type CrosswordInputs } from "./CrosswordGrid";
import { CrosswordResult } from "./CrosswordResult";
import { useCrosswordGame } from "./useCrosswordGame";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

export interface CrosswordGameContentProps {
  puzzle: CrosswordPuzzle;
  locale: Locale;
  messages: Messages;
}

export type ShareNote = { kind: "copied" | "shareFailed"; n: number } | null;

/**
 * The live message of the action bar and its tint: the share outcome after
 * the end, the verdict of a wrong check, or the instructions. A new key
 * replaces the paragraph, so the same message is announced again.
 */
export function barMessage(
  status: CrosswordStatus,
  wrongCheck: number,
  shareNote: ShareNote,
  messages: Messages,
): { message: JSX.Element | null; barState: string } {
  if (status !== "playing") {
    const barState = status === "won" ? " is-correct" : "";
    if (!shareNote) return { message: null, barState };
    const text = shareNote.kind === "copied" ? messages.copiedToClipboard : messages.shareFailed;
    return { message: <p key={shareNote.n}>{text}</p>, barState };
  }
  if (wrongCheck > 0) {
    return { message: <p key={wrongCheck} class="game-actions-title">{messages.crosswordWrong}</p>, barState: " is-incorrect" };
  }
  return { message: <p class="game-actions-hint">{messages.crosswordHint}</p>, barState: "" };
}

export function CrosswordGameContent({ puzzle, locale, messages }: CrosswordGameContentProps) {
  const game = useCrosswordGame(puzzle, locale);
  const { values, status, finished } = game;
  const [active, setActive] = useState(0);
  const inputs = useRef<CrosswordInputs>({});

  // Only a round finished in this visit moves focus to the result; a round
  // restored from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, finished && playedHere.current);

  const [shareNote, setShareNote] = useState<ShareNote>(null);
  const shares = useRef(0);
  const [confirmRevealOpen, setConfirmRevealOpen] = useState(false);
  const confirmRevealOpenRef = useRef(false);

  const closeRevealConfirm = useCallback(() => {
    confirmRevealOpenRef.current = false;
    setConfirmRevealOpen(false);
  }, []);

  const requestReveal = useCallback(() => {
    confirmRevealOpenRef.current = true;
    setConfirmRevealOpen(true);
  }, []);

  const confirmReveal = useCallback(() => {
    if (!confirmRevealOpenRef.current) return;
    closeRevealConfirm();
    playedHere.current = true;
    game.reveal();
  }, [closeRevealConfirm, game.reveal]);

  const selected = puzzle.entries[active] ?? puzzle.entries[0]!;
  const select = (index: number) => {
    const input = inputs.current[entryCellKey(puzzle.entries[index]!, 0)];
    input?.focus();
    input?.select();
    setActive(index);
  };
  const endHere = (action: () => void) => () => {
    playedHere.current = true;
    action();
  };
  const { message, barState } = barMessage(status, game.wrongCheck, shareNote, messages);

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
            {finished ? messages.crosswordBoardLabel : clueText(puzzle, puzzle.entries.indexOf(selected), locale, messages)}
          </p>
          <CrosswordGrid
            puzzle={puzzle}
            messages={messages}
            values={values}
            finished={finished}
            selected={selected}
            inputs={inputs}
            onSelectEntry={setActive}
            onLetters={game.setLetters}
          />
        </div>

        <div class="game-layout-side">
          <CrosswordClues
            puzzle={puzzle}
            locale={locale}
            messages={messages}
            active={active}
            finished={finished}
            onSelect={select}
          />

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
                checks={game.checks}
                correctWords={game.correctWords}
                titleRef={resultTitle}
                onRestart={() => {
                  setShareNote(null);
                  setActive(0);
                  game.restart();
                }}
                onCopied={() => setShareNote({ kind: "copied", n: ++shares.current })}
                onShareFailed={() => setShareNote({ kind: "shareFailed", n: ++shares.current })}
              />
            ) : (
              <div class="crossword-controls">
                <button type="button" class="btn btn-primary" onClick={endHere(game.check)}>
                  {messages.crosswordCheck}
                </button>
                <button type="button" class="btn btn-secondary" onClick={requestReveal}>
                  {messages.crosswordReveal}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmRevealOpen}
        title={messages.revealConfirmTitle}
        body={messages.revealConfirmBody}
        confirmLabel={messages.revealConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={confirmReveal}
        onCancel={closeRevealConfirm}
      />
    </section>
  );
}
