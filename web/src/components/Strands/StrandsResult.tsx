import type { Ref } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { StrandsPuzzle } from "../../lib/strands-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { useGameShareAction } from "../Results/use-game-share-action";
import { DailyNext } from "../Results/DailyNext";
import { SourceCitation } from "../Source/SourceCitation";
import { formatStrandsTime, generateStrandsShareSummary } from "./strands-share";
import { strandsWordKey } from "../../lib/strands-types";

interface SourceLine {
  key: string;
  project: "Wikidata" | "Wikipedia";
  revision: number;
  url: string;
  locator: string;
}

function wordSources(puzzle: StrandsPuzzle, wordKey: string): SourceLine[] {
  const word = puzzle.words.find((entry) => strandsWordKey(entry) === wordKey);
  if (!word?.evidence) return [];
  const lines = new Map<string, SourceLine>();
  for (const evidence of word.evidence) {
    const key = `${evidence.source_url}\u0000${evidence.revision_id}\u0000${evidence.locator}`;
    if (lines.has(key)) continue;
    let project: SourceLine["project"] = "Wikipedia";
    try {
      if (new URL(evidence.source_url).hostname === "www.wikidata.org") project = "Wikidata";
    } catch {
      // Keep Wikipedia as the fallback label when the URL cannot be parsed.
    }
    lines.set(key, {
      key,
      project,
      revision: evidence.revision_id,
      url: evidence.source_url,
      locator: evidence.locator,
    });
  }
  return [...lines.values()];
}

interface StrandsResultProps {
  puzzle: StrandsPuzzle;
  locale: Locale;
  elapsedSeconds: number;
  foundCount: number;
  gaveUp?: boolean;
  spangramFound: boolean;
  titleRef?: Ref<HTMLHeadingElement>;
  onCopied?: () => void;
  onShareFailed?: () => void;
  daily?: boolean;
}

export function StrandsResult({
  puzzle,
  locale,
  elapsedSeconds,
  foundCount,
  gaveUp = false,
  spangramFound,
  titleRef,
  onCopied,
  onShareFailed,
  daily = true,
}: StrandsResultProps) {
  const messages = getMessages(locale);
  const t = messages.strands;
  const [sourceOpen, setSourceOpen] = useState(false);
  const titleId = useId();
  const summaryId = useId();
  const sourceId = useId();
  const shareTextId = useId();
  const shareFailedId = useId();
  const source = useRef<HTMLDivElement>(null);
  const { copied, shareFailed, handleShare } = useGameShareAction({
    onCopied,
    onShareFailed,
    analytics: { game: "strands", locale, daily: daily ? "yes" : "no" },
  });

  const total = puzzle.words.length;
  const shareText = generateStrandsShareSummary(puzzle, foundCount, total, elapsedSeconds, locale, {
    daily,
  });

  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  return (
    <section class="strands-result word-search-result" data-testid="game-result" aria-labelledby={titleId}>
      <div class="word-search-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          aria-describedby={summaryId}
          class="game-actions-title strands-result-title word-search-result-title"
        >
          {gaveUp ? messages.resultTitle : t.congratulations}
        </h2>
        <p id={summaryId} class="word-search-result-summary">
          {t.resultSummary(foundCount, formatStrandsTime(elapsedSeconds))}
        </p>
        <p data-testid="spangram-result">{spangramFound ? t.spangramFound : t.spangramPending}</p>
      </div>

      <div class="word-search-result-buttons">
        <button type="button" class="btn btn-primary" onClick={() => { void handleShare(shareText); }}>
          {copied ? messages.copiedToClipboard : messages.share}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          aria-expanded={sourceOpen}
          aria-controls={sourceId}
          onClick={() => setSourceOpen((open) => !open)}
        >
          {sourceOpen ? messages.hideSource : messages.showSource}
        </button>
      </div>

      {daily && (
        <DailyNext
          game="strands"
          locale={locale}
          shareText={shareText}
          referenceDate={puzzle.reference_date}
        />
      )}

      {shareFailed && (
        <div class="word-search-share-fallback">
          <p id={shareFailedId}>{messages.shareFailed}</p>
          <textarea
            id={shareTextId}
            class="share-preview"
            readOnly
            rows={2}
            value={shareText}
            aria-label={messages.shareTextLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      <div ref={source} id={sourceId} class="word-search-source source-panel" hidden={!sourceOpen}>
        {puzzle.words.map((word) => {
          const key = strandsWordKey(word);
          const name = word.labels[locale] || word.labels.en;
          return (
            <div key={key} class="word-search-source-word">
              <h3 class="word-search-source-title">
                {name}
                {word.is_spangram ? ` (${t.spangramLabel})` : ""}
              </h3>
              <ul>
                {word.id && (
                  <li>
                    {messages.wordSearch.evidenceWikidataId}{" "}
                    <a href={`https://www.wikidata.org/wiki/${word.id}`} target="_blank" rel="noreferrer">
                      {word.id}
                    </a>
                  </li>
                )}
                {wordSources(puzzle, key).map((line) => (
                  <li key={line.key}>
                    <SourceCitation
                      url={line.url}
                      revision={line.revision}
                      locator={line.locator}
                      fallbackSite={messages.source.project(line.project)}
                      messages={messages}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
