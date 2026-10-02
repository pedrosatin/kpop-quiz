import { useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import {
  exportPlayerStatsJson,
  importPlayerStatsJson,
  loadPlayerStats,
  resetPlayerStats,
  type PlayerStats,
} from "../../lib/player-stats";

export interface StatsPortabilityProps {
  locale: Locale;
  onStatsChange: (stats: PlayerStats) => void;
  announce?: (message: string) => void;
}

export function StatsPortability({ locale, onStatsChange, announce }: StatsPortabilityProps) {
  const messages = getMessages(locale);
  const [statusMessage, setStatusMessage] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);

  const notify = (message: string) => {
    setStatusMessage(message);
    announce?.(message);
  };

  const handleExport = () => {
    const json = exportPlayerStatsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kpop-quiz-stats.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importPlayerStatsJson(String(reader.result ?? ""));
      if (result.success) {
        onStatsChange(loadPlayerStats());
        notify(messages.statsImportSuccess);
      } else {
        notify(messages.statsImportError);
      }
      input.value = "";
    };
    reader.readAsText(file);
  };

  const handleCancelReset = () => {
    setConfirmingReset(false);
    resetButtonRef.current?.focus();
  };

  const handleConfirmReset = () => {
    resetPlayerStats();
    onStatsChange(loadPlayerStats());
    setConfirmingReset(false);
    notify(messages.statsResetSuccess);
    resetButtonRef.current?.focus();
  };

  return (
    <div class="stats-portability">
      <div class="stats-portability-actions">
        <button type="button" class="btn btn-ghost btn-sm" onClick={handleExport}>
          {messages.statsExport}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => fileInputRef.current?.click()}
        >
          {messages.statsImport}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          class="visually-hidden"
          aria-label={messages.statsImport}
          onChange={handleFileChange}
        />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          ref={resetButtonRef}
          aria-expanded={confirmingReset}
          aria-controls="stats-reset-confirm"
          onClick={() => setConfirmingReset(true)}
        >
          {messages.statsReset}
        </button>
      </div>
      {confirmingReset && (
        <div id="stats-reset-confirm" class="stats-reset-confirm">
          <p id="stats-reset-confirm-text">{messages.statsResetConfirm}</p>
          <div role="group" aria-labelledby="stats-reset-confirm-text">
            <button type="button" class="btn btn-ghost btn-sm" onClick={handleConfirmReset}>
              {messages.statsConfirm}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={handleCancelReset}>
              {messages.statsCancel}
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" aria-atomic="true" class="stats-portability-message">
        {statusMessage}
      </p>
    </div>
  );
}
