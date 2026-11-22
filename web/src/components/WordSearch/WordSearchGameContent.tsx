import { useRef } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { buildLocalizedDisplayNames } from "../../lib/display-name";
import { useWordSearchGame, wordSearchMatchId } from "./useWordSearchGame";
import { WordSearchHeader } from "./WordSearchHeader";
import { WordSearchGrid } from "./WordSearchGrid";
import { WordSearchList } from "./WordSearchList";
import { WordSearchResult } from "./WordSearchResult";
import { WordSearchBarMessage, actionBarTone } from "./WordSearchBarMessage";
import { WordSearchProgress } from "./word-search-progress";
import { WordSearchShareNote, useShareNote } from "./word-search-share-note";
import { hasGivenUp } from "./word-search-state";
import { dailyBoardRound, useRecordDailyMatch } from "../../lib/use-record-daily-match";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useGiveUpConfirm } from "../../lib/use-give-up-confirm";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { DailyDone, useDailyMatchDone } from "../Results/DailyDone";

interface WordSearchGameContentProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  /** When false, free-play: no daily stats, DailyDone, or daily share. */
  daily?: boolean;
  /** Overrides the default home word-search share URL (used by group pages). */
  shareUrl?: string;
  /** Inside a group-page section (already an h2), demote inner titles to h3. */
  headingLevel?: 2 | 3;
}

export function WordSearchGameContent({
  puzzle,
  locale,
  daily = true,
  shareUrl,
  headingLevel = 2,
}: WordSearchGameContentProps) {
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
  } = useWordSearchGame(puzzle, locale, { daily });

  const totalWords = puzzle.words.length;
  const foundCount = foundWordIds.length;
  const completed = status === "completed";
  const gaveUp = hasGivenUp(status, foundCount, totalWords);

  // Only a puzzle finished in this visit moves focus to the result; one
  // restored from storage leaves focus where the page put it.
  const finishedOnLoad = useRef(completed);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, completed && !finishedOnLoad.current);

  const { shareNote, onCopied, onShareFailed } = useShareNote();
  const { confirmGiveUpOpen, requestGiveUp, closeGiveUpConfirm, confirmGiveUp } = useGiveUpConfirm();

  useRecordDailyMatch(
    "word-search",
    daily ? dailyBoardRound(puzzle, wordSearchMatchId(puzzle)) : null,
    completed,
    foundCount >= totalWords,
  );
  const dayDone = useDailyMatchDone(
    "word-search",
    puzzle.reference_date,
    wordSearchMatchId(puzzle),
    completed,
  );

  // Names are resolved against the whole list, so two words that differ only
  // by a disambiguator keep it.
  const displayNames = buildLocalizedDisplayNames(puzzle.words, locale);
  const wordName = (id: string) => displayNames.get(id) ?? "";

  const barState = actionBarTone(completed, lastCheck, activePath.length > 1 || anchorCell !== null);

  if (daily && dayDone) {
    return <DailyDone game="wordSearch" locale={locale} referenceDate={puzzle.reference_date} />;
  }

  return (
    <section class="game-card game-card--wide word-search" id="word-search" data-testid="game-board">
      <div class="word-search-layout">
        <WordSearchHeader puzzle={puzzle} locale={locale} headingLevel={headingLevel} />

        <div class="word-search-board">
          <WordSearchGrid
            board={puzzle}
            gridLabel={t.gridLabel}
            cellAria={t.cellAria}
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
          headingLevel={headingLevel}
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
          {/* While playing it says what the selection is doing; at the end
              it only announces a copy, and the result title takes its place. */}
          {completed ? (
            <WordSearchShareNote note={shareNote} messages={messages} />
          ) : (
            <WordSearchBarMessage
              puzzle={puzzle}
              t={t}
              activePath={activePath}
              anchorCell={anchorCell}
              lastCheck={lastCheck}
              foundCount={foundCount}
              wordName={wordName}
            />
          )}
        </div>
        {completed ? (
          <WordSearchResult
            puzzle={puzzle}
            locale={locale}
            elapsedSeconds={elapsedSeconds}
            foundCount={foundCount}
            gaveUp={gaveUp}
            titleRef={resultTitle}
            onCopied={onCopied}
            onShareFailed={onShareFailed}
            daily={daily}
            {...(shareUrl !== undefined ? { shareUrl } : {})}
          />
        ) : (
          <>
            <WordSearchProgress t={t} foundCount={foundCount} totalWords={totalWords} elapsedSeconds={elapsedSeconds} />
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
        onConfirm={() => confirmGiveUp(giveUp)}
        onCancel={closeGiveUpConfirm}
      />
    </section>
  );
}
