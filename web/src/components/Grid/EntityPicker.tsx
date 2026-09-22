import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { CandidateEntity, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { normalizeSearch } from "./types";

export interface EntityPickerProps {
  candidatePool: CandidateEntity[];
  usedEntityIds: Set<string>;
  uniquenessError?: string | null | undefined;
  rowLabel?: string | undefined;
  colLabel?: string | undefined;
  onSelectCandidate: (candidate: CandidateEntity) => void;
  onClose: () => void;
  locale: Locale;
  messages: Messages;
}

export function EntityPicker({
  candidatePool,
  usedEntityIds,
  uniquenessError,
  rowLabel,
  colLabel,
  onSelectCandidate,
  onClose,
  locale,
  messages,
}: EntityPickerProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listboxId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const norm = normalizeSearch(query);
    if (!norm) return candidatePool;
    return candidatePool.filter((c) => {
      const canonical = normalizeSearch(c.canonical_name);
      const localized = normalizeSearch(c.names[locale] || "");
      return canonical.includes(norm) || localized.includes(norm);
    });
  }, [candidatePool, query, locale]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (filtered.length > 0 ? Math.min(prev + 1, filtered.length - 1) : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filtered[activeIndex];
      if (selected) {
        onSelectCandidate(selected);
      }
    }
  };

  return (
    <div class="picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class="picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <div class="picker-header">
          <div>
            <h2 id={titleId} class="picker-title">
              {messages.gridPickerTitle}
            </h2>
            {rowLabel && colLabel && (
              <p class="picker-criteria-hint">
                {rowLabel} ∩ {colLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            class="picker-close-btn"
            onClick={onClose}
            aria-label={messages.gridClosePicker}
          >
            ✕
          </button>
        </div>

        <div class="picker-alert-region">
          {uniquenessError && (
            <div class="picker-alert-error" role="alert">
              <p>
                <strong>{uniquenessError}</strong>: {messages.gridAlreadyUsedError}
              </p>
            </div>
          )}
        </div>

        <div class="picker-search-field">
          <label for="picker-search-input" class="visually-hidden">
            {messages.gridPickerSearchLabel}
          </label>
          <input
            id="picker-search-input"
            ref={inputRef}
            type="search"
            class="picker-search-input"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder={messages.gridPickerSearchPlaceholder}
            autocomplete="off"
            aria-autocomplete="list"
            aria-controls={listboxId}
          />
        </div>

        <div class="visually-hidden" aria-live="polite" aria-atomic="true">
          {messages.gridPickerResultsCount(filtered.length)}
        </div>

        <ul
          id={listboxId}
          class="picker-candidate-list"
          role="listbox"
          aria-label={messages.gridPickerTitle}
        >
          {filtered.length === 0 ? (
            <li class="picker-no-matches">{messages.gridPickerNoMatches}</li>
          ) : (
            filtered.map((candidate, idx) => {
              const isUsed = usedEntityIds.has(candidate.id);
              const displayName = candidate.names[locale] || candidate.canonical_name;
              const isItemActive = idx === activeIndex;

              return (
                <li
                  key={candidate.id}
                  id={`candidate-opt-${candidate.id}`}
                  class={`picker-candidate-item ${isItemActive ? "active" : ""} ${isUsed ? "used" : ""}`}
                  role="option"
                  aria-selected={isItemActive}
                  aria-disabled={isUsed}
                  onClick={() => onSelectCandidate(candidate)}
                >
                  <span class="candidate-name">{displayName}</span>
                  {isUsed && (
                    <span class="candidate-badge-used">{messages.gridAlreadyUsedBadge}</span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
