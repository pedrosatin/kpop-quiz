import type { Ref } from "preact";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import type { Messages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { DailyNext } from "../Results/DailyNext";
import type { CodeGroupsShareFeedback } from "./useCodeGroupsShare";

export interface CodeGroupsResultProps {
  puzzle: CodeGroupsPuzzle;
  locale: Locale;
  messages: Messages;
  won: boolean;
  attemptsUsed: number;
  nameByQid: ReadonlyMap<string, string>;
  resultRef: Ref<HTMLElement>;
  share: {
    text: string;
    copied: boolean;
    failed: boolean;
    feedback: CodeGroupsShareFeedback | null;
    textId: string;
    failedId: string;
    onShare: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  };
}

/** The text to copy by hand when neither the share sheet nor the clipboard took it. */
function ShareFallback({ text, textId, failedId, messages }: { text: string; textId: string; failedId: string; messages: Messages }) {
  return (
    <div class="code-share-fallback">
      <p id={failedId}>{messages.shareFailed}</p>
      <textarea
        id={textId}
        class="share-preview"
        readOnly
        rows={4}
        value={text}
        aria-label={messages.shareTextLabel}
        aria-describedby={failedId}
        onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
        onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
      />
    </div>
  );
}

/** The six groups with a link to the Wikidata revision each one came from. */
function GroupSources({ puzzle, nameByQid, messages }: Pick<CodeGroupsResultProps, "puzzle" | "nameByQid" | "messages">) {
  return (
    <ul>
      {puzzle.symbols.map((s) => (
        <li key={s.qid}>
          <a href={s.source.url}>{`${nameByQid.get(s.qid) ?? s.name} · Wikidata`}</a> ·{" "}
          {`${messages.revision} ${s.source.revision_id}`}
        </li>
      ))}
    </ul>
  );
}

/** The finished round: verdict, revealed code, Share and the cited groups. */
export function CodeGroupsResult({ puzzle, locale, messages, won, attemptsUsed, nameByQid, resultRef, share }: CodeGroupsResultProps) {
  const label = (id: string) => nameByQid.get(id) ?? id;
  return (
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
        {messages.codeAttemptsUsed}: {attemptsUsed}/{puzzle.max_attempts}
      </p>
      <div class="code-result-buttons">
        <button
          type="button"
          class="btn btn-primary"
          onKeyDown={share.onKeyDown}
          onClick={share.onShare}
        >
          {share.copied ? messages.copiedToClipboard : messages.codeShareButton}
        </button>
      </div>
      <DailyNext game="code" locale={locale} shareText={share.text} referenceDate={puzzle.reference_date} />
      {share.failed && (
        <ShareFallback text={share.text} textId={share.textId} failedId={share.failedId} messages={messages} />
      )}
      <div class="visually-hidden" role="status" aria-live="polite">
        {share.feedback && (
          <p key={share.feedback.n}>
            {share.feedback.kind === "copied" ? messages.copiedToClipboard : messages.shareFailed}
          </p>
        )}
      </div>
      <h3>{messages.codeAboutGroups}</h3>
      <GroupSources puzzle={puzzle} nameByQid={nameByQid} messages={messages} />
      <p>Wikidata · CC0</p>
    </section>
  );
}
