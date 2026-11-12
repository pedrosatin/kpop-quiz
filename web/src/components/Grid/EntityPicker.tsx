import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { CandidateEntity, Locale } from "../../lib/quiz-types";
import { buildLocalizedDisplayNames } from "../../lib/display-name";
import type { Messages } from "../../i18n/catalog";
import { normalizeSearch } from "./types";

export interface EntityPickerProps {
  candidatePool: CandidateEntity[];
  usedEntityIds: Set<string>;
  /** Groups already refused in this cell; picking one again costs nothing. */
  triedEntityIds?: Set<string> | undefined;
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
  triedEntityIds,
  uniquenessError,
  rowLabel,
  colLabel,
  onSelectCandidate,
  onClose,
  locale,
  messages,
}: EntityPickerProps) {
  const [query, setQuery] = useState("");
  // The option the player moved to with the arrow keys; typing clears it.
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listboxId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The owner returns focus when the picker closes: to the cell after Close
  // or Escape, and to the next open cell after a guess.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // A phone keyboard covers the bottom of the layout viewport without
  // resizing it, so the backdrop follows the visual viewport and the list
  // shrinks to the part of the screen above the keyboard.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const backdrop = backdropRef.current;
    if (!vv || !backdrop) return;
    const fit = () => {
      backdrop.style.setProperty("--picker-vv-top", `${vv.offsetTop}px`);
      backdrop.style.setProperty("--picker-vv-height", `${vv.height}px`);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  const displayNames = useMemo(
    () => buildLocalizedDisplayNames(candidatePool, locale),
    [candidatePool, locale],
  );

  const filtered = useMemo(
    () => filterCandidates(candidatePool, query, locale, displayNames),
    [candidatePool, query, locale, displayNames],
  );

  // Enter sends only a group the player chose: one reached with the arrow
  // keys, or the one the search names. An empty search highlights nothing,
  // so Enter on it sends nothing.
  const activeIndex = navIndex ?? searchMatchIndex(filtered, query, locale, displayNames);
  const activeCandidate = activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const activeOptionId = activeCandidate ? `candidate-opt-${activeCandidate.id}` : undefined;

  // Arrow keys move the highlight; keep it inside the scrolled list.
  useEffect(() => {
    if (!activeOptionId) return;
    const option = listRef.current?.querySelector<HTMLElement>(`[id="${activeOptionId}"]`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      trapTab(e, dialogRef.current);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setNavIndex(movedIndex(e.key, activeIndex, filtered.length));
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (!e.repeat && activeCandidate) onSelectCandidate(activeCandidate);
    }
  };

  return (
    <div
      ref={backdropRef}
      class="modal-backdrop grid-picker-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
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
                {messages.gridPickerCriteria(rowLabel, colLabel)}
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
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setNavIndex(null);
            }}
            placeholder={messages.gridPickerSearchPlaceholder}
            autocomplete="off"
            // The list stays open under the field while the picker is open.
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
          />
        </div>

        <div class="visually-hidden" aria-live="polite" aria-atomic="true">
          {messages.gridPickerResultsCount(filtered.length)}
        </div>

        <ul
          ref={listRef}
          id={listboxId}
          class="picker-candidate-list"
          role="listbox"
          aria-label={messages.gridPickerTitle}
        >
          {filtered.length === 0 ? (
            <li class="picker-no-matches text-muted">{messages.gridPickerNoMatches}</li>
          ) : (
            filtered.map((candidate, idx) => (
              <CandidateOption
                key={candidate.id}
                candidate={candidate}
                name={displayNames.get(candidate.id) || candidate.canonical_name}
                active={idx === activeIndex}
                badge={candidateBadge(candidate.id, usedEntityIds, triedEntityIds, messages)}
                onSelect={onSelectCandidate}
              />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * The option a non-empty search names on its own: the only match, or the
 * first whose name equals the search. -1 when the search names none.
 */
function searchMatchIndex(
  filtered: CandidateEntity[],
  query: string,
  locale: Locale,
  displayNames: Map<string, string>,
): number {
  const norm = normalizeSearch(query);
  if (!norm) return -1;
  if (filtered.length === 1) return 0;
  return filtered.findIndex((c) =>
    [c.canonical_name, c.names[locale] || "", displayNames.get(c.id) || ""].some((name) => normalizeSearch(name) === norm),
  );
}

function CandidateOption({
  candidate,
  name,
  active,
  badge,
  onSelect,
}: {
  candidate: CandidateEntity;
  name: string;
  active: boolean;
  badge: string | null;
  onSelect: (candidate: CandidateEntity) => void;
}) {
  return (
    <li
      id={`candidate-opt-${candidate.id}`}
      class={`picker-candidate-item ${active ? "active" : ""} ${badge ? "used" : ""}`}
      role="option"
      aria-selected={active}
      aria-disabled={badge !== null}
      onClick={() => onSelect(candidate)}
    >
      <span class="candidate-name">{name}</span>
      {badge && <span class="badge">{badge}</span>}
    </li>
  );
}

/**
 * Why a group cannot go in this cell, in words: it is the answer of another
 * cell, or it was already refused here. Null when it can.
 */
function candidateBadge(
  id: string,
  used: Set<string>,
  tried: Set<string> | undefined,
  messages: Messages,
): string | null {
  if (used.has(id)) return messages.gridAlreadyUsedBadge;
  if (tried?.has(id)) return messages.gridTriedHereBadge;
  return null;
}

function filterCandidates(
  pool: CandidateEntity[],
  query: string,
  locale: Locale,
  displayNames: Map<string, string>,
): CandidateEntity[] {
  const norm = normalizeSearch(query);
  if (!norm) return pool;
  return pool.filter((c) =>
    [c.canonical_name, c.names[locale] || "", displayNames.get(c.id) || ""].some((name) => normalizeSearch(name).includes(norm)),
  );
}

/** The option an arrow key moves to; the first arrow from no highlight lands on the first group. */
function movedIndex(key: "ArrowDown" | "ArrowUp", active: number, count: number): number {
  return key === "ArrowDown" ? Math.min(active + 1, count - 1) : Math.max(active - 1, 0);
}

// Tab and Shift+Tab cycle between the search field and Close, so focus
// never reaches the page behind the dialog.
function trapTab(e: KeyboardEvent, dialog: HTMLElement | null) {
  const focusables = [
    ...(dialog?.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]:not([tabindex='-1'])") ?? []),
  ].filter((el) => !el.hasAttribute("disabled"));
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  const outside = !dialog?.contains(active);
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}
