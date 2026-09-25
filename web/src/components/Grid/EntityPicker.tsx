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
    // Return focus to the cell that opened the picker once it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected && !opener.hasAttribute("disabled")) opener.focus();
    };
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
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class="modal-card grid-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <div class="modal-header">
          <div>
            <h2 id={titleId} class="modal-title">
              {messages.gridPickerTitle}
            </h2>
            {rowLabel && colLabel && (
              <p class="modal-subtitle">
                {rowLabel} ∩ {colLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-icon modal-close"
            onClick={onClose}
            aria-label={messages.gridClosePicker}
          >
            ✕
          </button>
        </div>

        <div class="picker-alert-region">
          {uniquenessError && (
            <div class="alert-error" role="alert">
              <p>
                <strong>{uniquenessError}</strong>: {messages.gridAlreadyUsedError}
              </p>
            </div>
          )}
        </div>

        <div>
          <label for="picker-search-input" class="visually-hidden">
            {messages.gridPickerSearchLabel}
          </label>
          <input
            id="picker-search-input"
            ref={inputRef}
            type="search"
            class="text-input"
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
            <li class="picker-no-matches text-muted">{messages.gridPickerNoMatches}</li>
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
                    <span class="badge">{messages.gridAlreadyUsedBadge}</span>
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
