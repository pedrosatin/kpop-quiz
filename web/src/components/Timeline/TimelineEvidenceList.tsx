import type { Locale, TimelineEvidence } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { SourceCitation } from "../Source/SourceCitation";

/**
 * Each cited revision in words: the linked site and its language, the
 * revision and the place in the page, with the raw locator kept on the link.
 * A URL that cannot be linked falls back to the upstream source key.
 */
export function TimelineEvidenceList({ evidence, locale }: {
  evidence: TimelineEvidence[];
  locale: Locale;
}) {
  const messages = getMessages(locale);
  return (
    <ul class="timeline-evidence-list">
      {evidence.map((ev, index) => (
        <li key={`${ev.source_key}-${ev.revision_id}-${index}`} class="timeline-evidence-item">
          <SourceCitation
            url={ev.source_url}
            revision={ev.revision_id}
            locator={ev.locator}
            fallbackSite={ev.source_key}
            messages={messages}
          />
        </li>
      ))}
    </ul>
  );
}
