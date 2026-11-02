import type { Locale, TimelineEvidence } from "../../lib/quiz-types";

/** Label the linked revision's host, rather than an upstream reference key. */
export function timelineEvidenceLink(sourceUrl: string, locale: Locale) {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    let label = url.hostname;
    if (url.hostname === "en.wikipedia.org") {
      label = locale === "pt-BR" ? "Wikipédia em inglês" : "Wikipedia in English";
    }
    if (url.hostname === "www.wikidata.org") label = "Wikidata";
    return { href: url.href, label };
  } catch {
    return null;
  }
}

export function TimelineEvidenceList({ evidence, locale, revisionLabel }: {
  evidence: TimelineEvidence[];
  locale: Locale;
  revisionLabel: string;
}) {
  return (
    <ul class="timeline-evidence-list">
      {evidence.map((ev, index) => {
        const link = timelineEvidenceLink(ev.source_url, locale);
        return (
          <li key={`${ev.source_key}-${ev.revision_id}-${index}`} class="timeline-evidence-item">
            {link ? (
              <a href={link.href} target="_blank" rel="noopener noreferrer" class="timeline-evidence-link">
                {link.label}
              </a>
            ) : (
              <span class="timeline-evidence-source">{ev.source_key}</span>
            )}
            <span class="timeline-evidence-meta">
              {" · "}<span class="timeline-evidence-locator">{ev.locator}</span>
              {" · "}<span class="timeline-evidence-revision">{revisionLabel} {ev.revision_id}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
