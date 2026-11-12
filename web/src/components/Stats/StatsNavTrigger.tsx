import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import type { GameId } from "../../lib/player-stats";
import { getMessages } from "../../i18n/catalog";
import { StatsModal, type StatsTabId } from "./StatsModal";

export interface StatsNavTriggerProps {
  locale: Locale;
  /** The game of the page; the window opens on its tab. Without it, on "Geral" / "Overall". */
  game?: GameId;
}

export function StatsNavTrigger({ locale, game }: StatsNavTriggerProps) {
  const messages = getMessages(locale);
  const defaultTab: StatsTabId = game ?? "overall";
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StatsTabId>(defaultTab);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The element that gets focus back on close. The header button is set
  // explicitly: a tap in Safari, or a scripted click, does not focus it.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleOpenEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ tab?: StatsTabId }>;
      setActiveTab(customEvent.detail?.tab ?? defaultTab);
      returnFocusRef.current = null;
      setIsOpen(true);
    };

    window.addEventListener("kpop:open-stats", handleOpenEvent);
    return () => window.removeEventListener("kpop:open-stats", handleOpenEvent);
  }, [defaultTab]);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <button
        type="button"
        id="stats-open-nav-btn"
        class="btn btn-ghost btn-sm stats-trigger"
        ref={buttonRef}
        onClick={() => {
          setActiveTab(defaultTab);
          returnFocusRef.current = buttonRef.current;
          setIsOpen(true);
        }}
        aria-label={messages.statsOpenButton}
        title={messages.statsOpenButton}
      >
        <svg class="stats-trigger-icon" aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
          <rect x="2" y="10" width="4" height="8" rx="1" />
          <rect x="8" y="5" width="4" height="13" rx="1" />
          <rect x="14" y="2" width="4" height="16" rx="1" />
        </svg>
        <span class="stats-trigger-label">{messages.statsNavLabel}</span>
      </button>

      {isOpen && (
        <StatsModal
          isOpen={isOpen}
          onClose={close}
          locale={locale}
          initialTab={activeTab}
          returnFocusRef={returnFocusRef}
        />
      )}
    </>
  );
}
