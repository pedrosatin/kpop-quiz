import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import {
  loadPlayerStats,
  type GameId,
  type PlayerStats,
} from "../../lib/player-stats";

export type StatsTabId = "overall" | GameId;

export interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
  initialTab?: StatsTabId;
  stats?: PlayerStats;
}

export function StatsModal({
  isOpen,
  onClose,
  locale,
  initialTab = "overall",
  stats: propStats,
}: StatsModalProps) {
  const messages = getMessages(locale);
  const [activeTab, setActiveTab] = useState<StatsTabId>(initialTab);
  const [loadedStats, setLoadedStats] = useState<PlayerStats>(() => propStats || loadPlayerStats());

  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Reload stats whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setLoadedStats(propStats || loadPlayerStats());
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab, propStats]);

  // Focus trap & Escape key
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const currentStats = propStats || loadedStats;

  const currentMetrics = useMemo(() => {
    if (activeTab === "overall") {
      const { played, won, currentStreak, maxStreak } = currentStats.overall;
      const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
      return { played, won, winRate, currentStreak, maxStreak };
    }
    const game = currentStats.games[activeTab];
    const played = game?.played ?? 0;
    const won = game?.won ?? 0;
    const currentStreak = game?.currentStreak ?? 0;
    const maxStreak = game?.maxStreak ?? 0;
    const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
    return { played, won, winRate, currentStreak, maxStreak };
  }, [activeTab, currentStats]);

  const guessDistribution = useMemo(() => {
    return currentStats.games["name-guess"]?.guessDistribution || {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
    };
  }, [currentStats]);

  const maxGuessCount = useMemo(() => {
    const values = Object.values(guessDistribution);
    return Math.max(...values, 1);
  }, [guessDistribution]);

  if (!isOpen) return null;

  const tabs: { id: StatsTabId; label: string }[] = [
    { id: "overall", label: messages.statsTabOverall },
    { id: "quiz", label: messages.gameQuiz },
    { id: "grid", label: messages.gameGrid },
    { id: "connections", label: messages.gameConnections },
    { id: "name-guess", label: messages.gameNameGuess },
    { id: "word-search", label: messages.gameWordSearch },
  ];

  return (
    <div
      class="modal-backdrop stats-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="modal-card stats-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-modal-title"
        ref={modalRef}
      >
        <header class="modal-header stats-modal-header">
          <h2 id="stats-modal-title" class="modal-title">
            {messages.statsTitle}
          </h2>
          <button
            type="button"
            class="modal-close-btn"
            onClick={onClose}
            aria-label={messages.statsClose}
            ref={closeBtnRef}
          >
            ✕
          </button>
        </header>

        {/* Tab selection */}
        <div class="stats-tabs-container" role="tablist" aria-label={messages.statsTitle}>
          {tabs.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`stats-tab-${tab.id}`}
                aria-selected={isSelected}
                aria-controls={`stats-panel-${tab.id}`}
                tabIndex={isSelected ? 0 : -1}
                class={`stats-tab-btn ${isSelected ? "is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content Panel */}
        <div
          role="tabpanel"
          id={`stats-panel-${activeTab}`}
          aria-labelledby={`stats-tab-${activeTab}`}
          class="stats-tab-panel"
        >
          {/* Summary Cards */}
          <div class="stats-summary-grid">
            <div class="stats-card">
              <span class="stats-card-value">{currentMetrics.played}</span>
              <span class="stats-card-label">{messages.statsPlayed}</span>
            </div>
            <div class="stats-card">
              <span class="stats-card-value">{currentMetrics.winRate}%</span>
              <span class="stats-card-label">{messages.statsWinRate}</span>
            </div>
            <div class="stats-card">
              <span class="stats-card-value">
                {currentMetrics.currentStreak}
                <span class="stats-fire-icon" aria-hidden="true"> 🔥</span>
              </span>
              <span class="stats-card-label">{messages.statsCurrentStreak}</span>
            </div>
            <div class="stats-card">
              <span class="stats-card-value">{currentMetrics.maxStreak}</span>
              <span class="stats-card-label">{messages.statsMaxStreak}</span>
            </div>
          </div>

          {/* Name Guess Distribution (when name-guess tab is active) */}
          {activeTab === "name-guess" && (
            <div class="stats-distribution-section" aria-label={messages.statsGuessDistribution}>
              <h3 class="stats-distribution-title">{messages.statsGuessDistribution}</h3>
              <div class="stats-distribution-chart" role="img" aria-label={messages.statsGuessDistribution}>
                {[1, 2, 3, 4, 5, 6].map((attempt) => {
                  const count = guessDistribution[attempt] || 0;
                  const pct = Math.max(Math.round((count / maxGuessCount) * 100), 7);
                  return (
                    <div key={attempt} class="stats-distribution-row">
                      <span class="stats-attempt-num">{attempt}</span>
                      <div class="stats-bar-track">
                        <div
                          class={`stats-bar-fill ${count > 0 ? "has-count" : ""}`}
                          style={{ width: `${pct}%` }}
                          aria-label={`${attempt}: ${count}`}
                        >
                          <span class="stats-bar-count">{count}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
