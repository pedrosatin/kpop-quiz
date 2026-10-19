import { useId, useRef, useState } from "preact/hooks";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import type { Locale } from "../../lib/quiz-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";
import { useGameShareAction } from "../Results/use-game-share-action";
import { useResultActionGuard } from "../Results/use-result-action-guard";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useCodeGroupsGame } from "./useCodeGroupsGame";
import { useRecordCodeGroupsMatch } from "./useRecordCodeGroupsMatch";

export interface CodeGroupsGameContentProps {
  puzzle: CodeGroupsPuzzle;
  locale: Locale;
  messages: Messages;
}

/**
 * The result text without spoilers: the date, the verdict, the attempts line
 * and one row of pegs per guess. Exact (green) comes before misplaced
 * (yellow) and misses (white) fill the rest, so the share shows the same
 * aggregate counts the game does, never which positions were right.
 */
export function generateShareText(
  puzzle: CodeGroupsPuzzle,
  history: ReadonlyArray<{ ids: string[]; exact: number; misplaced: number }>,
  locale: Locale,
): string {
  const messages = getMessages(locale);
  const header = `K-pop Code ${puzzle.reference_date}`;
  const verdict = history.at(-1)?.exact === 4
    ? messages.codeShareWon(history.length)
    : messages.codeShareLost;
  const rows = history.map((guess) =>
    [
      ...Array<string>(guess.exact).fill("🟩"),
      ...Array<string>(guess.misplaced).fill("🟨"),
      ...Array<string>(4 - guess.exact - guess.misplaced).fill("⬜"),
    ].join(""),
  );
  return withShareUrl(
    `${header}\n${verdict}\n${messages.codeShareAttemptsLine(history.length)}\n\n${rows.join("\n")}`,
    seoShareUrl("code", locale),
  );
}

export function CodeGroupsGameContent({ puzzle, locale, messages }: CodeGroupsGameContentProps) {
  const { selection, history, won, finished, selectValue, submit, restart, feedback } =
    useCodeGroupsGame(puzzle, locale);
  useRecordCodeGroupsMatch(puzzle, finished, won);

  const playedHere = useRef(false);
  const submitHere = () => {
    playedHere.current = true;
    submit();
  };

  const resultRef = useRef<HTMLElement>(null);
  // Only a game finished in this visit moves focus to the result; a finished
  // game restored from storage leaves focus where the page put it.
  useFocusOnChange(resultRef, finished && playedHere.current);

  const { guarded, ignoreRepeat } = useResultActionGuard();
  const { copied, shareFailed, handleShare } = useGameShareAction({
    analytics: { game: "code", locale },
    onCopied: () => setShareFeedback({ kind: "copied", n: ++shares.current }),
    onShareFailed: () => setShareFeedback({ kind: "shareFailed", n: ++shares.current }),
  });

  const shareTextId = useId();
  const shareFailedId = useId();
  // The outcome of the last Share press; a new key replaces the live-region
  // paragraph, so the same message is announced again.
  const [shareFeedback, setShareFeedback] = useState<{ kind: "copied" | "shareFailed"; n: number } | null>(null);
  const shares = useRef(0);

  const label = (id: string) => puzzle.symbols.find((s) => s.qid === id)?.name ?? id;
  const shareText = generateShareText(puzzle, history, locale);
  const attemptsLeft = puzzle.max_attempts - history.length;

  let feedbackText = "";
  if (feedback?.kind === "chooseAll") feedbackText = messages.codeChooseAll;
  else if (feedback?.kind === "chooseDistinct") feedbackText = messages.codeChooseDistinct;
  else if (feedback?.kind === "attempt" && feedback.attempt) {
    const attemptNumber = history.indexOf(feedback.attempt) + 1;
    feedbackText = messages.codeAttemptFeedback(attemptNumber, feedback.attempt.exact, feedback.attempt.misplaced, attemptsLeft);
  }

  return (
    <section id="code-groups" aria-label={messages.codeTitle} class="game-card game-card--wide code-groups" data-testid="game-board">
      <p class="code-sequence-note">{messages.codeSequenceNote}</p>
      <p class="code-hud" data-testid="code-remaining">
        {messages.codeAttemptsLeft}: {attemptsLeft}/{puzzle.max_attempts}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitHere();
        }}
      >
        <fieldset disabled={finished}>
          <legend>{messages.codeYourGuess}</legend>
          <div class="code-slots">
            {selection.map((value, index) => (
              <label key={index}>
                {`${messages.codePosition} ${index + 1}`}
                <select
                  value={value}
                  onChange={(event) => selectValue(index, event.currentTarget.value)}
                  aria-label={`${messages.codePosition} ${index + 1}`}
                >
                  <option value="">{messages.codeChooseGroup}</option>
                  {puzzle.symbols.map((s) => (
                    <option value={s.qid} key={s.qid}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button class="btn btn-primary" type="submit">
            {messages.codeSubmit}
          </button>
        </fieldset>
      </form>
      <p role="status" aria-live="polite" aria-atomic="true" class="code-feedback">
        {feedbackText}
      </p>
      <h2>{messages.codeHistoryHeading}</h2>
      <ol class="code-history">
        {history.map((guess, index) => (
          <li key={index}>
            <span>{guess.ids.map(label).join(" / ")}</span>
            <strong>{messages.codeGuessSummary(guess.exact, guess.misplaced)}</strong>
          </li>
        ))}
      </ol>
      {finished && (
        <section
          class="game-result code-result"
          data-testid="game-result"
          aria-labelledby="code-result-title"
          tabIndex={-1}
          ref={resultRef}
        >
          <h2
            id="code-result-title"
            class={`result-title ${won ? "is-won" : "is-lost"}`}
          >
            {won ? messages.codeResultWon : messages.codeResultLost}
          </h2>
          <p>
            {messages.codeSecretLabel}: <strong>{puzzle.secret.map(label).join(" / ")}</strong>
          </p>
          <p>
            {messages.codeAttemptsUsed}: {history.length}/{puzzle.max_attempts}
          </p>
          <div class="code-result-buttons">
            <button
              type="button"
              class="btn btn-primary"
              onKeyDown={ignoreRepeat}
              onClick={guarded(() => {
                void handleShare(shareText);
              })}
            >
              {copied ? messages.copiedToClipboard : messages.codeShareButton}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              onKeyDown={ignoreRepeat}
              onClick={guarded(restart)}
            >
              {messages.restart}
            </button>
          </div>
          {shareFailed && (
            <div class="code-share-fallback">
              <p id={shareFailedId}>{messages.shareFailed}</p>
              <textarea
                id={shareTextId}
                class="share-preview"
                readOnly
                rows={4}
                value={shareText}
                aria-label={messages.shareTextLabel}
                aria-describedby={shareFailedId}
                onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
                onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
              />
            </div>
          )}
          <div class="visually-hidden" role="status" aria-live="polite">
            {shareFeedback && (
              <p key={shareFeedback.n}>
                {shareFeedback.kind === "copied" ? messages.copiedToClipboard : messages.shareFailed}
              </p>
            )}
          </div>
          <h3>{messages.codeAboutGroups}</h3>
          <ul>
            {puzzle.symbols.map((s) => (
              <li key={s.qid}>
                <a href={s.source.url}>{`${s.name} · Wikidata`}</a> ·{" "}
                {`${messages.revision} ${s.source.revision_id}`}
              </li>
            ))}
          </ul>
          <p>Wikidata · CC0</p>
        </section>
      )}
    </section>
  );
}
