import { useLayoutEffect, useRef } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import type { StatsTabId } from "./StatsModal";

export interface StatsTabsProps {
  activeTab: StatsTabId;
  onSelect: (tab: StatsTabId) => void;
  locale: Locale;
}

/**
 * Scrolls the tab list sideways just enough to show the selected tab. A game
 * page opens the window on its own tab, which on a phone may start past the
 * right edge. Only the list scrolls, never the page.
 */
export function revealSelectedTab(list: HTMLElement): void {
  const tab = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!tab) return;
  const listBox = list.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  if (tabBox.left < listBox.left) list.scrollLeft -= listBox.left - tabBox.left;
  else if (tabBox.right > listBox.right) list.scrollLeft += tabBox.right - listBox.right;
}

export function StatsTabs({ activeTab, onSelect, locale }: StatsTabsProps) {
  const messages = getMessages(locale);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (listRef.current) revealSelectedTab(listRef.current);
  }, [activeTab]);
  const tabs: { id: StatsTabId; label: string }[] = [
    { id: "overall", label: messages.statsTabOverall },
    { id: "quiz", label: messages.gameQuiz },
    { id: "grid", label: messages.gameGrid },
    { id: "connections", label: messages.gameConnections },
    { id: "name-guess", label: messages.gameNameGuess },
    { id: "word-search", label: messages.gameWordSearch },
    { id: "timeline", label: messages.gameTimeline },
    { id: "map", label: messages.gameMap },
    { id: "code", label: messages.gameCode },
    { id: "crossword", label: messages.gameCrossword },
  ];

  return (
    <div class="stats-tabs-container" role="tablist" aria-label={messages.statsTitle} ref={listRef}>
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
