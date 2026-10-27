import { useId, useMemo } from "preact/hooks";
import type { Locale, TimelineEvent } from "../../lib/quiz-types";
import type { TimelineResultsProps } from "./types";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";
import { getCanonicalChronologicalOrder } from "./timeline-utils";
import { TimelineEvidenceList } from "./TimelineEvidenceList";
import { TimelineShare } from "./TimelineShare";

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
  const defaultMsgs = DEFAULT_TIMELINE_MESSAGES[locale] || DEFAULT_TIMELINE_MESSAGES["pt-BR"];

  const chronologicalEvents = useMemo(() => {
    const list = canonicalEvents ?? events ?? [];
    return getCanonicalChronologicalOrder(list);
  }, [canonicalEvents, events]);

  const total = totalEvents ?? chronologicalEvents.length;
  const scoreBanner = messages?.scoreBanner
    ? messages.scoreBanner(score, total)
    : defaultMsgs.scoreBanner(score, total);

  const summaryHeading = messages?.summaryHeading ?? defaultMsgs.summaryHeading;
  const correctLabel = messages?.correctPosition ?? defaultMsgs.correctPosition;
  const incorrectLabel = messages?.incorrectPosition ?? defaultMsgs.incorrectPosition;
  const viewEvidence = messages?.viewEvidence ?? defaultMsgs.viewEvidence;
  const revisionLabel = messages?.revision ?? defaultMsgs.revision;

  return (
    <section class="timeline-results" data-testid="game-result" aria-labelledby={titleId}>
      <div class="timeline-results-banner">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          class="timeline-results-score"
        >
          {gaveUp ? (messages?.gaveUp ?? defaultMsgs.gaveUp) : scoreBanner}
        </h2>
        {gaveUp && <p>{(messages?.sequenceScore ?? defaultMsgs.sequenceScore)(score, total)}</p>}
      </div>

      <div class="timeline-results-summary">
        <h3 class="timeline-results-summary-heading">{summaryHeading}</h3>
        <ol class="timeline-results-list" role="list">
          {chronologicalEvents.map((event, index) => (
            <TimelineResultItem key={event.id} event={event} index={index} locale={locale}
              isCorrect={results[index] ?? false} correctLabel={correctLabel} incorrectLabel={incorrectLabel} />
          ))}
        </ol>
      </div>

      <details class="timeline-evidence-details">
        <summary class="timeline-evidence-summary">{viewEvidence}</summary>
        <div class="timeline-evidence-panel">
          {chronologicalEvents.map((event) => {
            const eventTitle =
              event.title[locale] || event.title["pt-BR"] || event.entity_name;
            return (
              <div key={event.id} class="timeline-evidence-event">
                <h4 class="timeline-evidence-event-title">{eventTitle}</h4>
                <TimelineEvidenceList evidence={event.evidence} locale={locale} revisionLabel={revisionLabel} />
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
    </section>
  );
}

function TimelineResultItem({ event, index, locale, isCorrect, correctLabel, incorrectLabel }: {
  event: TimelineEvent;
  index: number;
  locale: Locale;
  isCorrect: boolean;
  correctLabel: string;
  incorrectLabel: string;
}) {
  const accuracyClass = isCorrect ? "is-correct" : "is-incorrect";
  const indicatorLabel = isCorrect ? correctLabel : incorrectLabel;
  const displayDate = event.display_date[locale] ?? event.display_date["pt-BR"];
  const title = event.title[locale] || event.title["pt-BR"] || event.entity_name;
  return (
    <li class={`timeline-results-item ${accuracyClass}`}>
      <div class="timeline-results-item-header">
        <span role="img" class={`timeline-accuracy-badge ${accuracyClass}`} aria-label={`${indicatorLabel}: ${index + 1}`}>
          <span class="timeline-accuracy-emoji">{isCorrect ? "🟩" : "🟥"}</span>
          <span class="timeline-accuracy-symbol">{isCorrect ? " ✓" : " ✗"}</span>
        </span>
        <span class="timeline-revealed-date">{displayDate}</span>
      </div>
      <div class="timeline-results-item-body">
        <span class="timeline-results-item-title">{title}</span>
      </div>
    </li>
  );
}
