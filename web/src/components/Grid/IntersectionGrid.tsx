import { useEffect, useMemo, useRef } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { useGridGame } from "./useGridGame";
import { GridBoard } from "./GridBoard";
import { EntityPicker } from "./EntityPicker";
import { GridResults } from "./GridResults";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";

export interface IntersectionGridProps {
  locale: Locale;
  baseUrl?: string;
  messages?: Messages;
}

export function IntersectionGrid({ locale, baseUrl, messages: propMessages }: IntersectionGridProps) {
  const messages = propMessages ?? getMessages(locale);
  const {
    grid,
    status,
    errorKind,
    selectedCell,
    guessesUsed,
    maxGuesses,
    cells,
    usedEntityIds,
    uniquenessError,
    selectCell,
    closePicker,
    makeGuess,
    restartGame,
    reload,
  } = useGridGame(locale, baseUrl);

  const solvedCount = useMemo(() => {
    return Object.values(cells).filter((c) => c.solved).length;
  }, [cells]);

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (status === "complete" && grid) {
      const matchId = `grid-${grid.reference_date || grid.grid_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("grid", matchId)) {
        const isWin = solvedCount >= 5;
        recordGameFinish("grid", isWin, grid.reference_date || getTodayDateString());
        markGameMatchRecorded("grid", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (status !== "complete") {
      recordedMatchRef.current = null;
    }
  }, [status, grid, solvedCount]);

  if (status === "loading") {
    return (
      <section id="grid" class="game-card state" aria-live="polite" aria-busy="true">
        <span class="loader" aria-hidden="true" />
        <p>{messages.loading}</p>
      </section>
    );
  }

  if (status === "error" || !grid) {
    const errorMsg = errorKind === "missing" ? messages.artifactMissing : messages.loadError;
    return (
      <section id="grid" class="game-card state" aria-live="polite">
        <p>{errorMsg}</p>
        <button class="btn btn-primary" type="button" onClick={reload}>
          {messages.retry}
        </button>
      </section>
    );
  }

  if (status === "complete") {
    return (
      <section id="grid" class="game-card">
        <GridResults
          grid={grid}
          cellStates={cells}
          guessesUsed={guessesUsed}
          onRestart={restartGame}
          locale={locale}
          messages={messages}
        />
      </section>
    );
  }

  const selectedRowCrit = selectedCell ? grid.row_criteria[selectedCell.row]?.label[locale] : undefined;
  const selectedColCrit = selectedCell ? grid.col_criteria[selectedCell.col]?.label[locale] : undefined;

  return (
    <section id="grid" class="game-card" aria-labelledby="grid-hud-heading">
      <h2 id="grid-hud-heading" class="visually-hidden">
        {messages.gridTitle}
      </h2>
      <div class="game-hud">
        <p class="hud-item hud-value" aria-live="polite">
          {messages.gridGuessesLeft(maxGuesses - guessesUsed)}
        </p>
        <p class="hud-item hud-value" aria-live="polite">
          {messages.gridCorrectCount(solvedCount, 9)}
        </p>
      </div>

      <GridBoard
        grid={grid}
        cellStates={cells}
        selectedCell={selectedCell}
        onSelectCell={selectCell}
        disabled={status !== "ready" && status !== "cell_selected"}
        locale={locale}
        messages={messages}
      />

      {status === "cell_selected" && selectedCell && (
        <EntityPicker
          candidatePool={grid.candidate_pool}
          usedEntityIds={usedEntityIds}
          uniquenessError={uniquenessError}
          rowLabel={selectedRowCrit}
          colLabel={selectedColCrit}
          onSelectCandidate={makeGuess}
          onClose={closePicker}
          locale={locale}
          messages={messages}
        />
      )}
    </section>
  );
}
