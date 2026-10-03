import type { Locale } from "../../lib/quiz-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { useGridGame } from "./useGridGame";
import { IntersectionGridContent } from "./IntersectionGridContent";
import { CELL_GUARD_MS, nextCellAfterGuess } from "./next-cell-after-guess";

export interface IntersectionGridProps {
  locale: Locale;
  baseUrl?: string;
  messages?: Messages;
}

export { CELL_GUARD_MS, nextCellAfterGuess };

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

  if (status === "loading") {
    return (
      <section id="grid" class="game-card game-card--wide state" aria-live="polite" aria-busy="true">
        <span class="loader" aria-hidden="true" />
        <p>{messages.loading}</p>
      </section>
    );
  }

  if (status === "error" || !grid) {
    const errorMsg = errorKind === "missing" ? messages.gridDailyMissing : messages.loadError;
    return (
      <section id="grid" class="game-card game-card--wide state" data-testid="game-missing" aria-live="polite">
        <p>{errorMsg}</p>
        <button class="btn btn-primary" type="button" data-testid="game-retry" onClick={reload}>
          {messages.retry}
        </button>
      </section>
    );
  }

  return (
    <IntersectionGridContent
      grid={grid}
      locale={locale}
      messages={messages}
      status={status}
      selectedCell={selectedCell}
      guessesUsed={guessesUsed}
      maxGuesses={maxGuesses}
      cells={cells}
      usedEntityIds={usedEntityIds}
      uniquenessError={uniquenessError}
      selectCell={selectCell}
      closePicker={closePicker}
      makeGuess={makeGuess}
      restartGame={restartGame}
    />
  );
}
