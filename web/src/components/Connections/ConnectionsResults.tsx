import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ConnectionsPuzzle, Locale } from "../../lib/quiz-types";
import type { ConnectionsResultsProps } from "./types";
import { DIFFICULTY_COLORS } from "./types";
import { getMessages } from "../../i18n/catalog";

export function generateShareText({
  puzzle,
  guessHistory,
  mistakesRemaining,
  locale,
  monochrome,
}: {
  puzzle: ConnectionsResultsProps["puzzle"];
  guessHistory: string[][];
  mistakesRemaining: number;
  locale: ConnectionsResultsProps["locale"];
  monochrome: boolean;
}): string {
  const attempts = guessHistory.length;
  const mistakesUsed = 4 - mistakesRemaining;
  const solvedCount = puzzle.categories.filter((c) =>
    guessHistory.some((g) => c.item_ids.every((id) => g.includes(id)))
  ).length;

  const header = `K-pop Connections ${puzzle.reference_date}`;
  const messages = getMessages(locale);
  const resultLine = messages.connectionsShareResultLine(solvedCount);
  const attemptsLine = messages.connectionsShareGuessesLine(attempts, mistakesUsed);

  const rows = guessHistory.map((guess) => {
    return guess
      .map((itemId) => {
        const cat = puzzle.categories.find((c) => c.item_ids.includes(itemId));
        if (!cat) return "⬜";
        const diff = cat.difficulty_level;
        return monochrome ? DIFFICULTY_COLORS[diff].mono : DIFFICULTY_COLORS[diff].emoji;
      })
      .join("");
  });

  return `${header}\n${resultLine}\n${attemptsLine}\n\n${rows.join("\n")}`;
}

/** How long the result buttons ignore activation after they replace Submit. */
export const RESULT_GUARD_MS = 300;

interface SourceLine {
  key: string;
  /** Null when the fact id does not name one of the puzzle's items. */
  itemName: string | null;
  project: "Wikidata" | "Wikipedia";
  revision: number;
  url: string;
}

/**
 * Evidence of one category, one line per cited revision: an item's page
 * often backs the fact at several places of the same revision. The fact id
 * starts with the item's QID, which names the line.
 */
export function categorySources(
  puzzle: ConnectionsPuzzle,
  categoryId: string,
  locale: Locale,
): SourceLine[] {
  const category = puzzle.categories.find((c) => c.id === categoryId);
  if (!category) return [];
  const lines = new Map<string, SourceLine>();
  for (const evidence of category.evidence) {
    const key = `${evidence.source_url}\u0000${evidence.revision_id}`;
    if (lines.has(key)) continue;
    const qid = evidence.fact_base_id.split("$")[0];
    const item = puzzle.items.find((i) => i.id === qid);
    let project: SourceLine["project"] = "Wikipedia";
    try {
      if (new URL(evidence.source_url).hostname === "www.wikidata.org") project = "Wikidata";
    } catch {}
    lines.set(key, {
      key,
      itemName: item ? item.labels[locale] || item.canonical_name : null,
      project,
      revision: evidence.revision_id,
      url: evidence.source_url,
    });
  }
  return [...lines.values()];
}

/**
 * End of game, shown in the action bar in place of the controls. The bar
 * keeps the verdict and the buttons; the explanation and sources of every
 * category open below them on request, so the solved board stays in view.
 */
export function ConnectionsResults({
  puzzle,
  gameStatus,
  guessHistory,
  mistakesRemaining,
  onRestart,
  onCopied,
  onShareFailed,
  titleRef,
  locale,
  messages,
}: ConnectionsResultsProps) {
  const [monochrome, setMonochrome] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareTextId = useId();
  const shareFailedId = useId();
  const [sourceOpen, setSourceOpen] = useState(false);
  const titleId = useId();
  const sourceId = useId();
  const source = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);

  // The buttons appear where Submit was, so a second tap or a held Enter
  // meant for the last guess must not share or restart the game.
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, []);
  const guarded = (action: () => void) => () => {
    if (performance.now() - shownAt.current >= RESULT_GUARD_MS) action();
  };
  const ignoreRepeat = (event: KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  // The bar stops being sticky while the panel is open, so the panel can
  // open below the fold; bring it into view.
  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  const isWon = gameStatus === "won";
  const title = isWon ? messages.connectionsGameOverWon : messages.connectionsGameOverLost;
  const mistakesUsed = 4 - mistakesRemaining;
  const summary = isWon
    ? messages.connectionsResultSummaryWon(mistakesUsed)
    : messages.connectionsResultSummaryLost;

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const shareText = generateShareText({ puzzle, guessHistory, mistakesRemaining, locale, monochrome });

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

  const categories = [...puzzle.categories].sort((a, b) => a.difficulty_level - b.difficulty_level);

  return (
    <section class="connections-result" aria-labelledby={titleId}>
      <div class="connections-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          class={`game-actions-title connections-result-title ${isWon ? "is-won" : "is-lost"}`}
        >
          {title}
        </h2>
        <p class="connections-result-summary">{summary}</p>
      </div>

      <div class="connections-result-buttons">
        <button type="button" class="btn btn-primary" onKeyDown={ignoreRepeat} onClick={guarded(handleShare)}>
          {copied ? messages.copiedToClipboard : messages.connectionsShareButton}
        </button>
        <button type="button" class="btn btn-secondary" onKeyDown={ignoreRepeat} onClick={guarded(onRestart)}>
          {messages.connectionsRestart}
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
        <div class="connections-share-fallback">
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

      <label class="share-toggle connections-share-toggle">
        <input
          type="checkbox"
          checked={monochrome}
          onChange={(e) => setMonochrome((e.target as HTMLInputElement).checked)}
        />
        <span>{messages.connectionsHighContrastShare}</span>
      </label>

      <div ref={source} id={sourceId} class="connections-source" hidden={!sourceOpen}>
        {categories.map((category) => (
          <div key={category.id} class="connections-source-category">
            <h3 class="connections-source-title">{category.label[locale] || category.label["pt-BR"]}</h3>
            <p>{category.explanation[locale] || category.explanation["pt-BR"]}</p>
            <ul>
              {categorySources(puzzle, category.id, locale).map((line) => (
                <li key={line.key}>
                  {line.itemName
                    ? messages.connectionsSourceItem(line.itemName, line.project, line.revision)
                    : `${line.project}, ${messages.revision} ${line.revision}.`}{" "}
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
