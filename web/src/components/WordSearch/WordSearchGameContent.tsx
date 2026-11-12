import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { buildLocalizedDisplayNames } from "../../lib/display-name";
import { useWordSearchGame, wordSearchMatchId } from "./useWordSearchGame";
import { WordSearchHeader } from "./WordSearchHeader";
import { WordSearchGrid } from "./WordSearchGrid";
import { WordSearchList } from "./WordSearchList";
import { WordSearchResult } from "./WordSearchResult";
import { WordSearchBarMessage, barTone } from "./WordSearchBarMessage";
import { formatTime } from "./utils";
import { recordDailyBoardMatch } from "../../lib/player-stats";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { DailyDone, useDailyMatchDone } from "../Results/DailyDone";

interface WordSearchGameContentProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
}

export function WordSearchGameContent({ puzzle, locale }: WordSearchGameContentProps) {
  const messages = getMessages(locale);
  const t = messages.wordSearch;
  const {
    foundWordIds,
    elapsedSeconds,
    status,
    easyMode,
    setEasyMode,
    focusedCell,
    anchorCell,
    activePath,
    foundCellsMap,
    revealedCells,
    lastCheck,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
    giveUp,
  } = useWordSearchGame(puzzle, locale);

  const totalWords = puzzle.words.length;
  const foundCount = foundWordIds.length;
  const completed = status === "completed";
  const gaveUp = completed && foundCount < totalWords;

  // Only a puzzle finished in this visit moves focus to the result; one
  // restored from storage leaves focus where the page put it.
  const finishedOnLoad = useRef(completed);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, completed && !finishedOnLoad.current);

  // n changes on every share, so the same message is announced again.
  const [shareNote, setShareNote] = useState<{ kind: "copied" | "shareFailed"; n: number } | null>(null);
  const shares = useRef(0);

  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const confirmGiveUpOpenRef = useRef(false);

  const closeGiveUpConfirm = useCallback(() => {
    confirmGiveUpOpenRef.current = false;
    setConfirmGiveUpOpen(false);
  }, []);

  const requestGiveUp = useCallback(() => {
    confirmGiveUpOpenRef.current = true;
    setConfirmGiveUpOpen(true);
  }, []);

  const confirmGiveUp = useCallback(() => {
    if (!confirmGiveUpOpenRef.current) return;
    closeGiveUpConfirm();
    giveUp();
  }, [closeGiveUpConfirm, giveUp]);

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (completed && puzzle) {
      const matchId = wordSearchMatchId(puzzle);
      if (recordedMatchRef.current !== matchId) {
        recordDailyBoardMatch("word-search", puzzle, matchId, foundWordIds.length >= puzzle.words.length);
        recordedMatchRef.current = matchId;
      }
    } else if (!completed) {
      recordedMatchRef.current = null;
    }
  }, [completed, puzzle, foundWordIds.length]);
  const dayDone = useDailyMatchDone("word-search", puzzle.reference_date, wordSearchMatchId(puzzle), completed);

  // Names are resolved against the whole list, so two words that differ only
  // by a disambiguator keep it.
  const displayNames = buildLocalizedDisplayNames(puzzle.words, locale);
  const wordName = (id: string) => displayNames.get(id) ?? "";

  // While playing the bar says what the selection is doing (WordSearchBarMessage);
  // at the end it only announces a copy, and the result title takes its place.
  let message = null;
  let barState = barTone(lastCheck);
  if (completed) {
    // A new key replaces the paragraph, so a second copy is announced again.
    if (shareNote?.kind === "copied") message = <p key={shareNote.n}>{messages.copiedToClipboard}</p>;
    else if (shareNote?.kind === "shareFailed") message = <p key={shareNote.n}>{messages.shareFailed}</p>;
    barState = " is-correct";
  } else {
    if (activePath.length > 1 || anchorCell) barState = "";
    message = (
      <WordSearchBarMessage
        puzzle={puzzle}
        t={t}
        activePath={activePath}
        anchorCell={anchorCell}
        lastCheck={lastCheck}
        foundCount={foundCount}
        wordName={wordName}
      />
    );
  }

  if (dayDone) return <DailyDone game="wordSearch" locale={locale} />;

  return (
    <section class="game-card game-card--wide word-search" id="word-search" data-testid="game-board">
      <div class="word-search-layout">
        <WordSearchHeader puzzle={puzzle} locale={locale} />

        <div class="word-search-board">
          <WordSearchGrid
            puzzle={puzzle}
            locale={locale}
            focusedCell={focusedCell}
            anchorCell={anchorCell}
            activePath={activePath}
            foundCellsMap={foundCellsMap}
            revealedCells={revealedCells}
            onCellPointerDown={handleCellPointerDown}
            onCellPointerEnter={handleCellPointerEnter}
            onCellPointerUp={handleCellPointerUp}
            onKeyDown={handleKeyDown}
          />
        </div>

        <WordSearchList
          puzzle={puzzle}
          locale={locale}
          foundWordIds={foundWordIds}
          easyMode={easyMode}
          onToggleEasyMode={() => setEasyMode(!easyMode)}
          completed={completed}
        />
      </div>

      {/* Selection, verdict and progress while playing, the result at the
          end; the grid above never moves. */}
      <div class={`game-actions word-search-actions${barState}`}>
        {/* Mounted from the start so the first verdict is announced. At the end
            the result title takes its place, and this only announces the copy. */}
        <div
          class={`game-actions-message word-search-message${completed ? " visually-hidden" : ""}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
        {completed ? (
          <WordSearchResult
            puzzle={puzzle}
            locale={locale}
            elapsedSeconds={elapsedSeconds}
            foundCount={foundCount}
            gaveUp={gaveUp}
            titleRef={resultTitle}
            onCopied={() => setShareNote({ kind: "copied", n: ++shares.current })}
            onShareFailed={() => setShareNote({ kind: "shareFailed", n: ++shares.current })}
          />
        ) : (
          <>
            <dl class="word-search-progress">
              <div>
                <dt>{t.wordsFound}</dt>
                <dd data-testid="found-counter">{t.progress(foundCount, totalWords)}</dd>
              </div>
              <div>
                <dt>{t.timerLabel}</dt>
                <dd class="timer-display" data-testid="timer-display">{formatTime(elapsedSeconds)}</dd>
              </div>
            </dl>
            <button type="button" class="btn btn-secondary" onClick={requestGiveUp}>
              {messages.giveUp}
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmGiveUpOpen}
        title={messages.giveUpConfirmTitle}
        body={messages.giveUpConfirmBody}
        confirmLabel={messages.giveUpConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={confirmGiveUp}
        onCancel={closeGiveUpConfirm}
      />
    </section>
  );
}
