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
        class="game-nav-item game-nav-stats-btn"
        onClick={() => {
          setActiveTab("overall");
          setIsOpen(true);
        }}
        aria-label={messages.statsOpenButton}
        title={messages.statsOpenButton}
      >
        <span class="stats-btn-icon" aria-hidden="true">📊</span>
        <span class="stats-btn-label">{messages.statsNavLabel}</span>
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
