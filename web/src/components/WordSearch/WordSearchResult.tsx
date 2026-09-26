import type { Ref } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { formatTime, generateWordSearchShareSummary } from "./utils";

interface SourceLine {
  key: string;
  project: "Wikidata" | "Wikipedia";
  revision: number;
  url: string;
}

/** One line per cited revision of a word: a page often backs it at several places. */
export function wordSources(puzzle: WordSearchPuzzle, wordId: string): SourceLine[] {
  const word = puzzle.words.find((w) => w.id === wordId);
  if (!word) return [];
  const lines = new Map<string, SourceLine>();
  for (const evidence of word.evidence) {
    const key = `${evidence.source_url}\u0000${evidence.revision_id}`;
    if (lines.has(key)) continue;
    let project: SourceLine["project"] = "Wikipedia";
    try {
      if (new URL(evidence.source_url).hostname === "www.wikidata.org") project = "Wikidata";
    } catch {}
    lines.set(key, { key, project, revision: evidence.revision_id, url: evidence.source_url });
  }
  return [...lines.values()];
}

interface WordSearchResultProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  elapsedSeconds: number;
  titleRef?: Ref<HTMLHeadingElement>;
  onCopied?: () => void;
  onShareFailed?: () => void;
}

/**
 * End of the puzzle, shown in the action bar in place of the progress. The
 * bar keeps the verdict and the buttons; the sources of every word open
 * below them on request, so the solved grid stays in view.
 */
export function WordSearchResult({
  puzzle,
  locale,
  elapsedSeconds,
  titleRef,
  onCopied,
  onShareFailed,
}: WordSearchResultProps) {
  const messages = getMessages(locale);
  const t = messages.wordSearch;
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const sourceId = useId();
  const shareTextId = useId();
  const shareFailedId = useId();
  const source = useRef<HTMLDivElement>(null);

  const total = puzzle.words.length;
  const shareText = generateWordSearchShareSummary(puzzle, total, total, elapsedSeconds);

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  // The bar stops being sticky while the panel is open, so the panel can
  // open below the fold; bring it into view.
  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  // The share sheet first, where there is one; a player who closes it has not
  // hit an error. Then the clipboard. If neither takes the text, the text
  // shows in a field the player can select and copy by hand.
  const handleShare = async () => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (typeof nav?.share === "function") {
      try {
        await nav.share({ text: shareText });
        return;
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      }
    }
    try {
      if (typeof nav?.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await nav.clipboard.writeText(shareText);
    } catch {
      setShareFailed(true);
      onShareFailed?.();
      return;
    }
    setShareFailed(false);
    setCopied(true);
    onCopied?.();
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, 3000);
  };

  return (
    <section class="word-search-result" aria-labelledby={titleId}>
      <div class="word-search-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          class="game-actions-title word-search-result-title"
        >
          {t.congratulations}
        </h2>
        <p class="word-search-result-summary">{t.resultSummary(total, formatTime(elapsedSeconds))}</p>
      </div>

      <div class="word-search-result-buttons">
        <button type="button" class="btn btn-primary" onClick={handleShare}>
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

      <div ref={source} id={sourceId} class="word-search-source" hidden={!sourceOpen}>
        {puzzle.words.map((word) => (
          <div key={word.id} class="word-search-source-word">
            <h3 class="word-search-source-title">{word.labels[locale] || word.canonical_name}</h3>
            <ul>
              <li>
                {t.evidenceWikidataId}{" "}
                <a href={`https://www.wikidata.org/wiki/${word.id}`} target="_blank" rel="noreferrer">
                  {word.id}
                </a>
              </li>
              {wordSources(puzzle, word.id).map((line) => (
                <li key={line.key}>
                  {`${line.project}, ${messages.revision} ${line.revision}.`}{" "}
                  <a href={line.url} target="_blank" rel="noreferrer">
                    {messages.openRevision(line.project)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
