import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
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
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";

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

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (isGameOver && puzzle) {
      const matchId = `connections-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("connections", matchId)) {
        const isWin = gameStatus === "won";
        recordGameFinish("connections", isWin, puzzle.reference_date || getTodayDateString());
        markGameMatchRecorded("connections", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (!isGameOver) {
      recordedMatchRef.current = null;
    }
  }, [isGameOver, gameStatus, puzzle]);

  return (
    <section id="connections" class="game-card connections-game" aria-labelledby="connections-heading">
      <header class="game-hud connections-hud">
        <h2 id="connections-heading" class="visually-hidden">
          {messages.connectionsTitle}
        </h2>
        <MistakesRemaining mistakesRemaining={mistakesRemaining} messages={messages} />
      </header>

      {proximityFeedback && (
        <div class="alert-warning" role="status" aria-live="polite">
          {messages.connectionsOneAway}
        </div>
      )}

      {alreadyGuessedFeedback && (
        <div class="alert-warning" role="status" aria-live="polite">
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
        <div class="btn-row connections-controls">
          <button type="button" class="btn btn-secondary" onClick={shuffleItems}>
            {messages.connectionsShuffle}
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={selectedItemIds.length === 0}
            onClick={clearSelection}
          >
            {messages.connectionsDeselectAll}
          </button>
          <button
            type="button"
            class="btn btn-primary"
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
      <div id="connections">
        <QuizState message={messages.loading} busy={true} />
      </div>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? messages.artifactMissing : messages.loadError;
    return (
      <div id="connections">
        <QuizState message={errorMsg} actionLabel={messages.retry} onAction={loadData} />
      </div>
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
