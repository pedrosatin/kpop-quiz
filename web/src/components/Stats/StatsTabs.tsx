import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import type { StatsTabId } from "./StatsModal";

export interface StatsTabsProps {
  activeTab: StatsTabId;
  onSelect: (tab: StatsTabId) => void;
  locale: Locale;
}

export function StatsTabs({ activeTab, onSelect, locale }: StatsTabsProps) {
  const messages = getMessages(locale);
  const tabs: { id: StatsTabId; label: string }[] = [
    { id: "overall", label: messages.statsTabOverall },
    { id: "quiz", label: messages.gameQuiz },
    { id: "grid", label: messages.gameGrid },
    { id: "connections", label: messages.gameConnections },
    { id: "name-guess", label: messages.gameNameGuess },
    { id: "word-search", label: messages.gameWordSearch },
    { id: "timeline", label: messages.gameTimeline },
  ];

  return (
    <div class="stats-tabs-container" role="tablist" aria-label={messages.statsTitle}>
      {tabs.map((tab) => {
        const isSelected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`stats-tab-${tab.id}`}
            aria-selected={isSelected}
            aria-controls={`stats-panel-${tab.id}`}
            tabIndex={isSelected ? 0 : -1}
            class={`stats-tab-btn ${isSelected ? "is-active" : ""}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
