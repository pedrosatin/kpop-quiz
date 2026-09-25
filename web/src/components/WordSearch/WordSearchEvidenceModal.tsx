import { useEffect, useRef } from "preact/hooks";
import type { WordSearchWord } from "../../lib/word-search-types";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchEvidenceModalProps {
  word: WordSearchWord | null;
  locale: Locale;
  onClose: () => void;
}

export function WordSearchEvidenceModal({
  word,
  locale,
  onClose,
}: WordSearchEvidenceModalProps) {
  const t = getMessages(locale).wordSearch;
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!word) return;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [word, onClose]);

  if (!word) return null;

  const entityName = word.labels[locale] || word.canonical_name;

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="modal-card evidence-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-dialog-title"
      >
        <div class="modal-header">
          <h2 id="evidence-dialog-title" class="modal-title">
            {t.evidenceModalTitle}: {entityName}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            class="btn btn-ghost btn-icon modal-close"
            onClick={onClose}
            aria-label={t.close}
          >
            ✕
          </button>
        </div>

        <div class="modal-body">
          <p>
            <strong>{t.evidenceWikidataId}</strong>{" "}
            <a
              href={`https://www.wikidata.org/wiki/${word.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {word.id}
            </a>
          </p>
          {word.clue && (
            <p>
              <strong>{t.evidenceClue}</strong> {word.clue[locale] || word.clue.en}
            </p>
          )}

          <h3 class="evidence-list-heading">{t.evidenceSourcesHeading}</h3>
          <ul class="evidence-list">
            {word.evidence.map((item, idx) => (
              <li key={`ev-${idx}`} class="evidence-item">
                <span class="evidence-source">{t.evidenceSource} {item.source_key}</span>
                <span class="evidence-locator">{t.evidenceLocator} {item.locator}</span>
                <span class="evidence-rev">{t.evidenceRevision} {item.revision_id}</span>
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="evidence-link"
                >
                  {t.evidenceOpen}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
