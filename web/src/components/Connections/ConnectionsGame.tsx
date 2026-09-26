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
import { useFocusOnChange } from "../../lib/use-focus-on-change";

export interface ConnectionsGameContentProps {
  puzzle: ConnectionsPuzzle;
  locale: Locale;
  messages: Messages;
  onReload?: () => void;
}

/** How long Submit ignores a second activation after a guess. */
export const SUBMIT_GUARD_MS = 300;

type Feedback =
  | { kind: "solved"; categoryId: string }
  | { kind: "wrong" | "oneAway" | "repeat" | "copied" };

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

  // The verdict of the last guess shows in the action bar until the next
  // tile or Clear. It never sits above the board, so the tiles do not move.
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Only a game finished in this visit moves focus to the result; a game
  // restored from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const lastSubmitAt = useRef(-Infinity);
  const grid = useRef<HTMLDivElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const [solvedHere, setSolvedHere] = useState(0);
  const [restarts, setRestarts] = useState(0);

  const toggle = useCallback((id: string) => {
    setFeedback(null);
    toggleSelectItem(id);
  }, [toggleSelectItem]);

  // Clear disables itself, so focus moves to the board instead of the page.
  const clear = useCallback(() => {
    setFeedback(null);
    clearSelection();
    grid.current?.querySelector<HTMLButtonElement>(".connections-tile")?.focus({ preventScroll: true });
  }, [clearSelection]);

  // A double click or a held Enter would send the same four names again and
  // replace the verdict with "already tried".
  const submit = useCallback(() => {
    const now = performance.now();
    if (now - lastSubmitAt.current < SUBMIT_GUARD_MS) return;
    lastSubmitAt.current = now;
    playedHere.current = true;
    const result = submitGuess();
    if (result.success && result.category) {
      setFeedback({ kind: "solved", categoryId: result.category.id });
      setSolvedHere((n) => n + 1);
    } else if (result.alreadyGuessed) {
      setFeedback({ kind: "repeat" });
    } else {
      setFeedback({ kind: result.oneAway ? "oneAway" : "wrong" });
    }
  }, [submitGuess]);

  const restart = useCallback(() => {
    setFeedback(null);
    restartGame();
    setRestarts((n) => n + 1);
  }, [restartGame]);

  // A solved group takes its four tiles and disables Submit, so focus moves
  // to the first tile left instead of falling to the page. Play again does
  // the same with the new board.
  const focusStep = `${solvedHere}:${restarts}`;
  const refocusBoard = !isGameOver && (solvedHere > 0 || restarts > 0);
  useEffect(() => {
    if (!refocusBoard) return;
    grid.current?.querySelector<HTMLButtonElement>(".connections-tile")?.focus({ preventScroll: true });
  }, [refocusBoard, focusStep]);
  useFocusOnChange(resultTitle, isGameOver && playedHere.current);

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

  let message = null;
  if (isGameOver) {
    message = feedback?.kind === "copied" ? <p>{messages.copiedToClipboard}</p> : null;
  } else if (feedback?.kind === "solved") {
    const category = puzzle.categories.find((c) => c.id === feedback.categoryId);
    if (category) {
      message = (
        <p class="connections-feedback">
          <strong class="game-actions-title">
            {messages.connectionsSolved(category.label[locale] || category.label["pt-BR"])}
          </strong>{" "}
          {category.explanation[locale] || category.explanation["pt-BR"]}
        </p>
      );
    }
  } else if (feedback?.kind === "oneAway") {
    message = <p class="connections-feedback game-actions-title">{messages.connectionsOneAway}</p>;
  } else if (feedback?.kind === "wrong") {
    message = <p class="connections-feedback game-actions-title">{messages.connectionsWrong}</p>;
  } else if (feedback?.kind === "repeat") {
    message = <p class="connections-feedback game-actions-title">{messages.connectionsAlreadyGuessed}</p>;
  } else {
    message = <p class="game-actions-hint">{messages.connectionsHint}</p>;
  }

  let barState = "";
  if (isGameOver) barState = gameStatus === "won" ? " is-correct" : " is-incorrect";
  else if (feedback?.kind === "solved") barState = " is-correct";
  else if (feedback?.kind === "wrong" || feedback?.kind === "oneAway") barState = " is-incorrect";

  return (
    <section id="connections" class="game-card connections-game" aria-labelledby="connections-heading">
      <header class="game-hud connections-hud">
        <h2 id="connections-heading" class="visually-hidden">
          {messages.connectionsTitle}
        </h2>
        <MistakesRemaining mistakesRemaining={mistakesRemaining} messages={messages} />
      </header>

      <ConnectionsBoard
        categories={puzzle.categories}
        solvedCategoryIds={solvedCategoryIds}
        boardItems={boardItems}
        allItems={puzzle.items}
        selectedItemIds={selectedItemIds}
        onToggleItem={toggle}
        disabled={isGameOver}
        gridRef={grid}
        locale={locale}
        messages={messages}
      />

      {/* Controls while playing, the result at the end; the board above never moves. */}
      <div class={`game-actions connections-actions${barState}`}>
        {/* Mounted from the start so the first verdict is announced. At the end
            the result title takes the screen, and this only announces the copy. */}
        <div
          class={`game-actions-message connections-message${isGameOver ? " visually-hidden" : ""}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
        {isGameOver ? (
          <ConnectionsResults
            puzzle={puzzle}
            gameStatus={gameStatus}
            guessHistory={guessHistory}
            mistakesRemaining={mistakesRemaining}
            onRestart={restart}
            onCopied={() => setFeedback({ kind: "copied" })}
            titleRef={resultTitle}
            locale={locale}
            messages={messages}
          />
        ) : (
          <div class="connections-controls">
            <button type="button" class="btn btn-secondary" onClick={shuffleItems}>
              {messages.connectionsShuffle}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={selectedItemIds.length === 0}
              onClick={clear}
            >
              {messages.connectionsDeselectAll}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={selectedItemIds.length !== 4}
              onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
              onClick={submit}
            >
              {messages.connectionsSubmit}
            </button>
          </div>
        )}
      </div>
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
