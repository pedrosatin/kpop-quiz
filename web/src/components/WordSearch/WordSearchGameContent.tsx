import { useState } from "preact/hooks";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";
import { useWordSearchGame } from "./useWordSearchGame";
import { WordSearchHeader } from "./WordSearchHeader";
import { WordSearchGrid } from "./WordSearchGrid";
import { WordSearchList } from "./WordSearchList";
import { WordSearchEvidenceModal } from "./WordSearchEvidenceModal";
import { WordSearchResultModal } from "./WordSearchResultModal";

interface WordSearchGameContentProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
}

export function WordSearchGameContent({ puzzle, locale }: WordSearchGameContentProps) {
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
