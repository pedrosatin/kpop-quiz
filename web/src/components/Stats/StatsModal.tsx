import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import {
  loadPlayerStats,
  type GameId,
  type PlayerStats,
} from "../../lib/player-stats";
import { StatsTabs } from "./StatsTabs";
import { StatsSummary } from "./StatsSummary";
import { StatsDistribution } from "./StatsDistribution";
import { StatsPortability } from "./StatsPortability";

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

  // The optional stats prop pins the view for tests; the production caller
  // StatsNavTrigger never passes it, so post-import refresh flows through loadedStats.
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

  if (!isOpen) return null;

  return (
    <div
      class="modal-backdrop"
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
        <header class="modal-header">
          <h2 id="stats-modal-title" class="modal-title">
            {messages.statsTitle}
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-icon modal-close"
            onClick={onClose}
            aria-label={messages.statsClose}
            ref={closeBtnRef}
          >
            ✕
          </button>
        </header>

        <StatsTabs activeTab={activeTab} onSelect={setActiveTab} locale={locale} />

        <div
          role="tabpanel"
          id={`stats-panel-${activeTab}`}
          aria-labelledby={`stats-tab-${activeTab}`}
          class="stats-tab-panel"
        >
          <StatsSummary metrics={currentMetrics} locale={locale} />
          {activeTab === "name-guess" && (
            <StatsDistribution stats={currentStats} locale={locale} />
          )}
        </div>

        <StatsPortability locale={locale} onStatsChange={setLoadedStats} />
      </div>
    </div>
  );
}
