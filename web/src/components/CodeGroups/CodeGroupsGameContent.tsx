import { useId, useRef } from "preact/hooks";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import type { Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { feedbackMessage, generateShareText, groupNamesByQid } from "./code-groups-text";
import { useCodeGroupsShare } from "./useCodeGroupsShare";
import { useResultActionGuard } from "../Results/use-result-action-guard";
import { CodeGroupsResult } from "./code-groups-result";
import { DailyDone, useDailyMatchDone } from "../Results/DailyDone";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useCodeGroupsGame } from "./useCodeGroupsGame";
import { codeGroupsMatchId, useRecordCodeGroupsMatch } from "./useRecordCodeGroupsMatch";
import { useCodeGroupsFeedbackScroll } from "./useCodeGroupsFeedbackScroll";
import { CodeGroupsGuessForm } from "./code-groups-guess-form";
import { CodeGroupsHistory } from "./code-groups-history";

export interface CodeGroupsGameContentProps {
  puzzle: CodeGroupsPuzzle;
  locale: Locale;
  messages: Messages;
}

export function CodeGroupsGameContent({ puzzle, locale, messages }: CodeGroupsGameContentProps) {
  const { selection, history, won, finished, selectValue, submit, feedback } =
    useCodeGroupsGame(puzzle, locale);
  useRecordCodeGroupsMatch(puzzle, finished, won);
  const dayDone = useDailyMatchDone("code", puzzle.reference_date, codeGroupsMatchId(puzzle), finished);

  const playedHere = useRef(false);
  const submitHere = () => {
    playedHere.current = true;
    submit();
  };

  const resultRef = useRef<HTMLElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  // Only a game finished in this visit moves focus to the result; a finished
  // game restored from storage leaves focus where the page put it.
  useFocusOnChange(resultRef, finished && playedHere.current);
  useCodeGroupsFeedbackScroll(feedback, finished, playedHere, resultRef, feedbackRef);

  // The guard starts when the board mounts, so it stays in this component.
  const { guarded, ignoreRepeat } = useResultActionGuard();
  const { copied, shareFailed, handleShare, shareFeedback } = useCodeGroupsShare(locale);

  // The ids keep their order in the island's useId sequence.
  const shareTextId = useId();
  const shareFailedId = useId();

  const nameByQid = groupNamesByQid(puzzle);
  const label = (id: string) => nameByQid.get(id) ?? id;
  const shareText = generateShareText(puzzle, history, locale);
  const attemptsLeft = puzzle.max_attempts - history.length;

  const feedbackText = feedbackMessage(feedback, history, attemptsLeft, messages);

  if (dayDone) return <DailyDone game="code" locale={locale} />;

  return (
    <section id="code-groups" tabIndex={-1} aria-label={messages.codeTitle} class="game-card game-card--wide code-groups" data-testid="game-board">
      <p class="code-sequence-note">{messages.codeSequenceNote}</p>
      {/* Once the round ends the result takes the counter's place, above the
          locked form and the history, so it shows without scrolling past them. */}
      {finished ? (
        <CodeGroupsResult
          puzzle={puzzle}
          locale={locale}
          messages={messages}
          won={won}
          attemptsUsed={history.length}
          nameByQid={nameByQid}
          resultRef={resultRef}
          share={{
            text: shareText,
            copied,
            failed: shareFailed,
            feedback: shareFeedback,
            textId: shareTextId,
            failedId: shareFailedId,
            onShare: guarded(() => {
              void handleShare(shareText);
            }),
            onKeyDown: ignoreRepeat,
          }}
        />
      ) : (
        <p class="code-hud" data-testid="code-remaining">
          {messages.codeAttemptsLeft(attemptsLeft)}: {attemptsLeft}/{puzzle.max_attempts}
        </p>
      )}
      <CodeGroupsGuessForm
        symbols={puzzle.symbols}
        nameByQid={nameByQid}
        selection={selection}
        finished={finished}
        messages={messages}
        onSelect={selectValue}
        onSubmit={submitHere}
        onRepeatKey={ignoreRepeat}
      />
      <p ref={feedbackRef} role="status" aria-live="polite" aria-atomic="true" class="code-feedback">
        {feedbackText}
      </p>
      <CodeGroupsHistory history={history} label={label} messages={messages} />
    </section>
  );
}
