import { useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { StatsModal, type StatsTabId } from "./StatsModal";

export interface StatsNavTriggerProps {
  locale: Locale;
}

export function StatsNavTrigger({ locale }: StatsNavTriggerProps) {
  const messages = getMessages(locale);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StatsTabId>("overall");

  useEffect(() => {
    const handleOpenEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ tab?: StatsTabId }>;
      if (customEvent.detail?.tab) {
        setActiveTab(customEvent.detail.tab);
      } else {
        setActiveTab("overall");
      }
      setIsOpen(true);
    };

    window.addEventListener("kpop:open-stats", handleOpenEvent);
    return () => window.removeEventListener("kpop:open-stats", handleOpenEvent);
  }, []);

  return (
    <>
      <button
        type="button"
        id="stats-open-nav-btn"
        class="btn btn-ghost btn-sm stats-trigger"
        onClick={() => {
          setActiveTab("overall");
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
          onClose={() => setIsOpen(false)}
          locale={locale}
          initialTab={activeTab}
        />
      )}
    </>
  );
}
