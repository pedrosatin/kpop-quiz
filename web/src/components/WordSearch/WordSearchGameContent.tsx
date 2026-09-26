import { useEffect, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useWordSearchGame } from "./useWordSearchGame";
import { WordSearchHeader } from "./WordSearchHeader";
import { WordSearchGrid } from "./WordSearchGrid";
import { WordSearchList } from "./WordSearchList";
import { WordSearchResult } from "./WordSearchResult";
import { formatTime } from "./utils";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import { useFocusOnChange } from "../../lib/use-focus-on-change";

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
    lastCheck,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
  } = useWordSearchGame(puzzle, locale);

  const totalWords = puzzle.words.length;
  const foundCount = foundWordIds.length;
  const completed = status === "completed";

  // Only a puzzle finished in this visit moves focus to the result; one
  // restored from storage leaves focus where the page put it.
  const finishedOnLoad = useRef(completed);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, completed && !finishedOnLoad.current);

  // n changes on every share, so the same message is announced again.
  const [shareNote, setShareNote] = useState<{ kind: "copied" | "shareFailed"; n: number } | null>(null);
  const shares = useRef(0);

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (completed && puzzle) {
      const matchId = `word-search-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("word-search", matchId)) {
        recordGameFinish("word-search", true, puzzle.reference_date || getTodayDateString());
        markGameMatchRecorded("word-search", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (!completed) {
      recordedMatchRef.current = null;
    }
  }, [completed, puzzle]);

  const wordName = (id: string) => {
    const word = puzzle.words.find((w) => w.id === id);
    return word ? word.labels[locale] || word.canonical_name : "";
  };

  // One message at a time, in two reserved lines: the selection in progress,
  // then the verdict of the last one, then the instructions.
  let message = null;
  let barState = "";
  if (completed) {
    // A new key replaces the paragraph, so a second copy is announced again.
    if (shareNote?.kind === "copied") message = <p key={shareNote.n}>{messages.copiedToClipboard}</p>;
    else if (shareNote?.kind === "shareFailed") message = <p key={shareNote.n}>{messages.shareFailed}</p>;
    barState = " is-correct";
  } else if (activePath.length > 1) {
    message = (
      <p class="word-search-selection">
        <strong>{t.selectionLabel}</strong>{" "}
        <span class="selection-letters">
          {activePath.map((c) => puzzle.grid[c.row]?.[c.col] ?? "").join("")}
        </span>{" "}
        <span class="selection-count">({t.lettersCount(activePath.length)})</span>
      </p>
    );
  } else if (anchorCell) {
    message = (
      <p class="game-actions-title">
        {t.anchorHint(puzzle.grid[anchorCell.row]?.[anchorCell.col] ?? "")}
      </p>
    );
  } else if (lastCheck?.kind === "found") {
    message = (
      <p key={lastCheck.n} class="game-actions-title">
        {t.foundFeedback(wordName(lastCheck.wordId))}
        <span class="visually-hidden"> {t.progressAnnouncement(foundCount, totalWords)}</span>
      </p>
    );
    barState = " is-correct";
  } else if (lastCheck?.kind === "repeat") {
    message = (
      <p key={lastCheck.n} class="game-actions-title">
        {t.repeatFeedback(wordName(lastCheck.wordId))}
      </p>
    );
  } else if (lastCheck?.kind === "miss") {
    message = (
      <p key={lastCheck.n} class="game-actions-title">
        {t.missFeedback(lastCheck.letters)}
      </p>
    );
    barState = " is-incorrect";
  } else {
    message = <p class="game-actions-hint">{t.selectionHint}</p>;
  }

  return (
    <section class="game-card game-card--wide word-search" id="word-search">
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
            titleRef={resultTitle}
            onCopied={() => setShareNote({ kind: "copied", n: ++shares.current })}
            onShareFailed={() => setShareNote({ kind: "shareFailed", n: ++shares.current })}
          />
        ) : (
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
        )}
      </div>
    </section>
  );
}
