import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ConnectionsPuzzle, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { getMessages } from "../../i18n/catalog";
import { QuizState } from "../Quiz/QuizState";
import { ConnectionsArtifactError, loadConnectionsPuzzle } from "../../data/connections-loader";
import { ConnectionsBoard } from "./ConnectionsBoard";
import { ConnectionsResults } from "./ConnectionsResults";
import { MistakesRemaining } from "./MistakesRemaining";
import type { ConnectionsGameProps } from "./types";
import { useConnectionsGame } from "./useConnectionsGame";

export interface ConnectionsGameContentProps {
  puzzle: ConnectionsPuzzle;
  locale: Locale;
  messages: Messages;
  onReload?: () => void;
}

export function ConnectionsGameContent({
  puzzle,
  locale,
  messages,
}: ConnectionsGameContentProps) {
  const {
    selectedItemIds,
    solvedCategoryIds,
    mistakesRemaining,
    guessHistory,
    gameStatus,
    boardItemIds,
    proximityFeedback,
    alreadyGuessedFeedback,
    toggleSelectItem,
    clearSelection,
    shuffleItems,
    submitGuess,
    restartGame,
  } = useConnectionsGame(puzzle, locale);

  const boardItems = useMemo(() => {
    return boardItemIds
      .map((id) => puzzle.items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => Boolean(i));
  }, [puzzle, boardItemIds]);

  const isGameOver = gameStatus === "won" || gameStatus === "lost";

  return (
    <section id="connections" class="connections-card-shell" aria-labelledby="connections-heading">
      <header class="connections-header">
        <h2 id="connections-heading" class="visually-hidden">
          {messages.connectionsTitle}
        </h2>
        <div class="connections-hud">
          <MistakesRemaining mistakesRemaining={mistakesRemaining} messages={messages} />
        </div>
      </header>

      {proximityFeedback && (
        <div class="connections-proximity-banner" role="status" aria-live="polite">
          {messages.connectionsOneAway}
        </div>
      )}

      {alreadyGuessedFeedback && (
        <div class="connections-proximity-banner" role="status" aria-live="polite">
          {messages.connectionsAlreadyGuessed}
        </div>
      )}

      <ConnectionsBoard
        categories={puzzle.categories}
        solvedCategoryIds={solvedCategoryIds}
        boardItems={boardItems}
        allItems={puzzle.items}
        selectedItemIds={selectedItemIds}
        onToggleItem={toggleSelectItem}
        disabled={isGameOver}
        locale={locale}
        messages={messages}
      />

      {!isGameOver && (
        <div class="connections-controls">
          <button type="button" class="connections-ctrl-btn" onClick={shuffleItems}>
            {messages.connectionsShuffle}
          </button>
          <button
            type="button"
            class="connections-ctrl-btn"
            disabled={selectedItemIds.length === 0}
            onClick={clearSelection}
          >
            {messages.connectionsDeselectAll}
          </button>
          <button
            type="button"
            class="connections-ctrl-btn connections-submit-btn"
            disabled={selectedItemIds.length !== 4}
            onClick={submitGuess}
          >
            {messages.connectionsSubmit}
          </button>
        </div>
      )}

      {isGameOver && (
        <ConnectionsResults
          puzzle={puzzle}
          gameStatus={gameStatus}
          guessHistory={guessHistory}
          mistakesRemaining={mistakesRemaining}
          onRestart={restartGame}
          locale={locale}
          messages={messages}
        />
      )}
    </section>
  );
}

export function ConnectionsGame({
  locale,
  baseUrl,
  messages: propMessages,
  puzzle: initialPuzzle,
}: ConnectionsGameProps) {
  const messages = propMessages ?? getMessages(locale);
  const [loadedPuzzle, setLoadedPuzzle] = useState<ConnectionsPuzzle | null>(initialPuzzle ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(initialPuzzle ? "ready" : "loading");
  const [errorKind, setErrorKind] = useState<"missing" | "invalid" | undefined>();

  const loadData = useCallback(async () => {
    if (initialPuzzle) {
      setLoadedPuzzle(initialPuzzle);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadConnectionsPuzzle(locale, baseUrl);
      setLoadedPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof ConnectionsArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [initialPuzzle, locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section id="connections" class="connections-card-shell" aria-live="polite">
        <QuizState message={messages.loading} busy={true} />
      </section>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? messages.artifactMissing : messages.loadError;
    return (
      <section id="connections" class="connections-card-shell">
        <QuizState message={errorMsg} actionLabel={messages.retry} onAction={loadData} />
      </section>
    );
  }

  return (
    <ConnectionsGameContent
      puzzle={loadedPuzzle}
      locale={locale}
      messages={messages}
      onReload={loadData}
    />
  );
}
