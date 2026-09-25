import { useEffect, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useWordSearchGame } from "./useWordSearchGame";
import { WordSearchHeader } from "./WordSearchHeader";
import { WordSearchGrid } from "./WordSearchGrid";
import { WordSearchList } from "./WordSearchList";
import { WordSearchEvidenceModal } from "./WordSearchEvidenceModal";
import { WordSearchResultModal } from "./WordSearchResultModal";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";

interface WordSearchGameContentProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
}

export function WordSearchGameContent({ puzzle, locale }: WordSearchGameContentProps) {
  const t = getMessages(locale).wordSearch;
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
    announcement,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
  } = useWordSearchGame(puzzle, locale);

  const [evidenceWord, setEvidenceWord] = useState<WordSearchWord | null>(null);
  const [showResultModal, setShowResultModal] = useState<boolean>(true);

  const totalWords = puzzle.words.length;
  const foundCount = foundWordIds.length;

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (status === "completed" && puzzle) {
      const matchId = `word-search-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("word-search", matchId)) {
        recordGameFinish("word-search", true, puzzle.reference_date || getTodayDateString());
        markGameMatchRecorded("word-search", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (status !== "completed") {
      recordedMatchRef.current = null;
    }
  }, [status, puzzle]);

  return (
    <div class="word-search-container" id="word-search">
      <WordSearchHeader
        puzzle={puzzle}
        locale={locale}
        foundCount={foundCount}
        totalCount={totalWords}
        elapsedSeconds={elapsedSeconds}
        easyMode={easyMode}
        onToggleEasyMode={() => setEasyMode(!easyMode)}
      />

      <div class="word-search-layout">
        <div class="word-search-main-col">
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
          <div class="word-search-selection-bar" aria-live="polite">
            {activePath.length > 1 ? (
              <span class="active-selection-text">
                <strong class="selection-label">{t.selectionLabel} </strong>
                <span class="selection-letters">
                  {activePath.map((c) => puzzle.grid[c.row]?.[c.col] ?? "").join("")}
                </span>
                <span class="selection-count">
                  ({t.lettersCount(activePath.length)})
                </span>
              </span>
            ) : anchorCell ? (
              <span class="hint-selection-text anchor-active-hint">
                {t.anchorHint(puzzle.grid[anchorCell.row]?.[anchorCell.col] ?? "")}
              </span>
            ) : (
              <span class="hint-selection-text">
                {t.selectionHint}
              </span>
            )}
          </div>
        </div>

        <div class="word-search-side-col">
          <WordSearchList
            puzzle={puzzle}
            locale={locale}
            foundWordIds={foundWordIds}
            easyMode={easyMode}
            onSelectEvidenceWord={(w) => setEvidenceWord(w)}
          />
        </div>
      </div>

      <div class="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {evidenceWord && (
        <WordSearchEvidenceModal
          word={evidenceWord}
          locale={locale}
          onClose={() => setEvidenceWord(null)}
        />
      )}

      {status === "completed" && showResultModal && (
        <WordSearchResultModal
          puzzle={puzzle}
          locale={locale}
          foundCount={foundCount}
          totalCount={totalWords}
          elapsedSeconds={elapsedSeconds}
          onClose={() => setShowResultModal(false)}
        />
      )}
    </div>
  );
}
