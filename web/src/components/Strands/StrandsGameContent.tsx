import { useRef } from "preact/hooks";
import type { StrandsPuzzle } from "../../lib/strands-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { WordSearchGrid } from "../WordSearch/WordSearchGrid";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useGiveUpConfirm } from "../../lib/use-give-up-confirm";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { StrandsBarMessage } from "./StrandsBarMessage";
import { StrandsList } from "./StrandsList";
import { StrandsProgress } from "./StrandsProgress";
import { cellKey } from "./trail";
import { useStrandsGame } from "./useStrandsGame";

interface StrandsGameContentProps {
  puzzle: StrandsPuzzle;
  locale: Locale;
  daily?: boolean;
  headingLevel?: 2 | 3;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function StrandsGameContent({
  puzzle,
  locale,
  headingLevel = 2,
}: StrandsGameContentProps) {
  const messages = getMessages(locale);
  const t = messages.strands;
  const {
    foundKeys,
    elapsedSeconds,
    status,
    foundCellsMap,
    spangramKeys,
    spangramFound,
    wordName,
    focusedCell,
    path,
    activeLetters,
    lastCheck,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
    confirmTrail,
    cancelTrail,
    giveUp,
  } = useStrandsGame(puzzle, locale);
  const hasTrail = path.length > 0;

  const completed = status === "completed";
  const finishedOnLoad = useRef(completed);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, completed && !finishedOnLoad.current);

  const { confirmGiveUpOpen, requestGiveUp, closeGiveUpConfirm, confirmGiveUp } = useGiveUpConfirm();

  const themeTitle = puzzle.theme[locale] || puzzle.theme.en;
  const themeDesc = puzzle.theme_description?.[locale] || puzzle.theme_description?.en;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const anchorCell = path.length > 0 ? path[0]! : null;

  return (
    <section class="game-card game-card--wide strands word-search" id="strands" data-testid="game-board">
      <div class="word-search-layout strands-layout">
        <header class="word-search-header">
          <p class="strands-theme-label">{t.themeLabel}</p>
          <Heading class="word-search-theme-title" data-testid="strands-theme">
            {themeTitle}
          </Heading>
          {themeDesc && <p class="word-search-theme-desc">{themeDesc}</p>}
        </header>

        <div class="word-search-board">
          <WordSearchGrid
            board={puzzle}
            gridLabel={t.gridLabel}
            cellAria={(row, col, letter, selected, found) =>
              t.cellAria(row, col, letter, selected, found, found && spangramKeys.has(cellKey({ row, col })))
            }
            focusedCell={focusedCell}
            anchorCell={anchorCell}
            activePath={path}
            foundCellsMap={foundCellsMap}
            cellExtraClass={(row, col) =>
              spangramKeys.has(cellKey({ row, col })) && foundCellsMap.has(cellKey({ row, col }))
                ? "is-spangram"
                : undefined
            }
            onCellPointerDown={handleCellPointerDown}
            onCellPointerEnter={handleCellPointerEnter}
            onCellPointerUp={handleCellPointerUp}
            onKeyDown={handleKeyDown}
          />
        </div>

        <StrandsList
          puzzle={puzzle}
          locale={locale}
          foundKeys={foundKeys}
          headingLevel={headingLevel}
        />
      </div>

      <div class={`game-actions word-search-actions${completed ? " is-complete" : ""}`}>
        <div
          class={`game-actions-message word-search-message${completed ? " visually-hidden" : ""}`}
          role="status"
          aria-live="polite"
        >
          {completed ? (
            <span>{t.congratulations}</span>
          ) : (
            <StrandsBarMessage
              t={t}
              activeLetters={activeLetters}
              lastCheck={lastCheck}
              wordName={wordName}
              foundCount={foundKeys.length}
              totalWords={puzzle.words.length}
            />
          )}
        </div>
        {completed ? (
          <div class="strands-result" data-testid="game-result">
            <h2 ref={resultTitle} tabIndex={-1} class="strands-result-title">
              {t.congratulations}
            </h2>
            <p>{t.resultSummary(foundKeys.length, formatTime(elapsedSeconds))}</p>
            <p data-testid="spangram-result">
              {spangramFound ? t.spangramFound : t.spangramPending}
            </p>
          </div>
        ) : (
          <>
            <StrandsProgress
              t={t}
              foundCount={foundKeys.length}
              totalWords={puzzle.words.length}
              spangramFound={spangramFound}
              elapsedSeconds={elapsedSeconds}
            />
            <button
              type="button"
              class="btn btn-primary"
              onClick={confirmTrail}
              disabled={!hasTrail}
              data-testid="strands-confirm"
            >
              {t.confirm}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              onClick={cancelTrail}
              disabled={!hasTrail}
              data-testid="strands-clear"
            >
              {t.clear}
            </button>
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
