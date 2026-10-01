import { useId, useMemo } from "preact/hooks";
import type { TimelineResultsProps } from "./types";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";
import { getCanonicalChronologicalOrder } from "./timeline-utils";
import { TimelineShare } from "./TimelineShare";

export function TimelineResults({
  score,
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
    <section class="timeline-results" aria-labelledby={titleId}>
      <div class="timeline-results-banner">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          class="timeline-results-score"
        >
          {scoreBanner}
        </h2>
      </div>

      <div class="timeline-results-summary">
        <h3 class="timeline-results-summary-heading">{summaryHeading}</h3>
        <ol class="timeline-results-list" role="list">
          {chronologicalEvents.map((event, index) => {
            const isCorrect = results[index] ?? false;
            const indicatorLabel = isCorrect ? correctLabel : incorrectLabel;
            const displayDate =
              event.display_date[locale] ?? event.display_date["pt-BR"];
            const title =
              event.title[locale] || event.title["pt-BR"] || event.entity_name;

            return (
              <li
                key={event.id}
                class={`timeline-results-item ${isCorrect ? "is-correct" : "is-incorrect"}`}
              >
                <div class="timeline-results-item-header">
                  <span
                    role="img"
                    class={`timeline-accuracy-badge ${isCorrect ? "is-correct" : "is-incorrect"}`}
                    aria-label={`${indicatorLabel}: ${index + 1}`}
                  >
                    <span class="timeline-accuracy-emoji">
                      {isCorrect ? "🟩" : "🟥"}
                    </span>
                    <span class="timeline-accuracy-symbol">
                      {isCorrect ? " ✓" : " ✗"}
                    </span>
                  </span>
                  <span class="timeline-revealed-date">{displayDate}</span>
                </div>
                <div class="timeline-results-item-body">
                  <span class="timeline-results-item-title">{title}</span>
                </div>
              </li>
            );
          })}
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
                <ul class="timeline-evidence-list">
                  {event.evidence.map((ev, evIndex) => {
                    const isSafeUrl =
                      typeof ev.source_url === "string" &&
                      (ev.source_url.startsWith("https://") ||
                        ev.source_url.startsWith("http://"));

                    return (
                      <li
                        key={`${event.id}-${ev.source_key}-${ev.revision_id}-${evIndex}`}
                        class="timeline-evidence-item"
                      >
                        {isSafeUrl ? (
                          <a
                            href={ev.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="timeline-evidence-link"
                          >
                            {ev.source_key}
                          </a>
                        ) : (
                          <span class="timeline-evidence-source">
                            {ev.source_key}
                          </span>
                        )}
                        <span class="timeline-evidence-meta">
                          {" · "}
                          <span class="timeline-evidence-locator">
                            {ev.locator}
                          </span>
                          {" · "}
                          <span class="timeline-evidence-revision">
                            {revisionLabel} {ev.revision_id}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
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
export { TimelineShare } from "./TimelineShare";
