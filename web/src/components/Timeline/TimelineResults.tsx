import { useId, useMemo } from "preact/hooks";
import type { Locale, TimelineEvent } from "../../lib/quiz-types";
import type { TimelineResultsProps } from "./types";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";
import { getCanonicalChronologicalOrder } from "./timeline-utils";
import { TimelineEvidenceList } from "./TimelineEvidenceList";
import { TimelineShare } from "./TimelineShare";
import { DailyNext } from "../Results/DailyNext";

export function TimelineResults({
  score,
  gaveUp = false,
  totalEvents,
  results,
  canonicalEvents,
  events,
  shareText,
  locale = "pt-BR",
  onShareSuccess,
  onShareError,
  onCopied,
  onShareFailed,
  messages,
  titleRef,
}: TimelineResultsProps) {
  const titleId = useId();
  const msgs = withDefaults(DEFAULT_TIMELINE_MESSAGES[locale] || DEFAULT_TIMELINE_MESSAGES["pt-BR"], messages);

  const chronologicalEvents = useMemo(() => {
    const list = canonicalEvents ?? events ?? [];
    return getCanonicalChronologicalOrder(list);
  }, [canonicalEvents, events]);

  // 1-based position where the player left each event, when the order is known.
  const playerPositions = useMemo(
    () => new Map((events ?? []).map((event, index) => [event.id, index + 1])),
    [events]
  );

  const total = totalEvents ?? chronologicalEvents.length;
  const positionLabels = { player: msgs.playerPosition, right: msgs.rightPosition };

  return (
    <section class="timeline-results" data-testid="game-result" aria-labelledby={titleId}>
      <div class="timeline-results-banner">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          class="timeline-results-score"
        >
          {gaveUp ? msgs.gaveUp : msgs.scoreBanner(score, total)}
        </h2>
        {gaveUp && <p>{msgs.sequenceScore(score, total)}</p>}
      </div>

      <div class="timeline-results-summary">
        <h3 class="timeline-results-summary-heading">{msgs.summaryHeading}</h3>
        <ol class="timeline-results-list" role="list">
          {chronologicalEvents.map((event, index) => (
            <TimelineResultItem key={event.id} event={event} index={index} locale={locale}
              isCorrect={results[index] ?? false} correctLabel={msgs.correctPosition} incorrectLabel={msgs.incorrectPosition}
              playerPosition={playerPositions.get(event.id)} positionLabels={positionLabels} />
          ))}
        </ol>
      </div>

      <details class="timeline-evidence-details">
        <summary class="timeline-evidence-summary">{msgs.viewEvidence}</summary>
        <div class="timeline-evidence-panel">
          {chronologicalEvents.map((event) => {
            const eventTitle =
              event.title[locale] || event.title["pt-BR"] || event.entity_name;
            return (
              <div key={event.id} class="timeline-evidence-event">
                <h4 class="timeline-evidence-event-title">{eventTitle}</h4>
                <TimelineEvidenceList evidence={event.evidence} locale={locale} revisionLabel={msgs.revision} />
              </div>
            );
          })}
        </div>
      </details>

      <TimelineShare
        shareText={shareText}
        locale={locale}
        messages={messages}
        onShareSuccess={onShareSuccess ?? onCopied}
        onShareError={onShareError ?? onShareFailed}
      />

      <DailyNext game="timeline" locale={locale} />
    </section>
  );
}

/** `defaults` with every override that is set; an `undefined` override keeps the default. */
function withDefaults<T extends object>(defaults: T, overrides: Partial<T> | undefined): T {
  const merged: T = { ...defaults };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function TimelineResultItem({ event, index, locale, isCorrect, correctLabel, incorrectLabel, playerPosition, positionLabels }: {
  event: TimelineEvent;
  index: number;
  locale: Locale;
  isCorrect: boolean;
  correctLabel: string;
  incorrectLabel: string;
  playerPosition: number | undefined;
  positionLabels: { player: (position: number) => string; right: (position: number) => string };
}) {
  const accuracyClass = isCorrect ? "is-correct" : "is-incorrect";
  const indicatorLabel = isCorrect ? correctLabel : incorrectLabel;
  const displayDate = event.display_date[locale] ?? event.display_date["pt-BR"];
  const title = event.title[locale] || event.title["pt-BR"] || event.entity_name;
  return (
    <li class={`timeline-results-item ${accuracyClass}`}>
      <div class="timeline-results-item-header">
        <span role="img" class={`timeline-accuracy-badge ${accuracyClass}`} aria-label={indicatorLabel}>
          <span class="timeline-accuracy-emoji">{isCorrect ? "🟩" : "🟥"}</span>
          <span class="timeline-accuracy-symbol">{isCorrect ? " ✓" : " ✗"}</span>
        </span>
        <span class="timeline-revealed-date">{displayDate}</span>
      </div>
      <div class="timeline-results-item-body">
        <span class="timeline-results-item-title">{title}</span>
        <p class="timeline-results-positions" data-testid="timeline-result-positions">
          {playerPosition !== undefined && (
            <>
              <span>{positionLabels.player(playerPosition)}</span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <span>{positionLabels.right(index + 1)}</span>
        </p>
      </div>
    </li>
  );
}
