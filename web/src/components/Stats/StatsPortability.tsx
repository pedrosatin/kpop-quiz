import { useEffect, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { formatCalendarDate } from "../../lib/format-date";
import {
  applyPlayerStatsFile,
  exportPlayerStatsJson,
  loadPlayerStats,
  parsePlayerStatsJson,
  resetPlayerStats,
  type OverallStats,
  type PlayerStats,
  type PlayerStatsFile,
} from "../../lib/player-stats";

export interface StatsPortabilityProps {
  locale: Locale;
  onStatsChange: (stats: PlayerStats) => void;
}

interface PendingImport {
  file: PlayerStatsFile;
  /** Local stats when the file was picked, shown next to the file's. */
  local: PlayerStats;
}

/** The export time in the player's own time zone, where the file was made. */
function formatExportedAt(exportedAt: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(exportedAt));
}

function ImportComparison({
  local,
  file,
  locale,
  messages,
}: {
  local: OverallStats;
  file: OverallStats;
  locale: Locale;
  messages: Messages;
}) {
  const lastPlayed = (stats: OverallStats) =>
    stats.lastPlayedDate ? formatCalendarDate(stats.lastPlayedDate, locale) : messages.statsLastPlayedNone;
  const rows: Array<[string, string | number, string | number]> = [
    [messages.statsPlayed, local.played, file.played],
    [messages.statsWon, local.won, file.won],
    [messages.statsCurrentStreak, local.currentStreak, file.currentStreak],
    [messages.statsMaxStreak, local.maxStreak, file.maxStreak],
    [messages.statsLastPlayed, lastPlayed(local), lastPlayed(file)],
  ];
  return (
    <table class="stats-import-table">
      <caption>{messages.statsImportTotals}</caption>
      <thead>
        <tr>
          <td />
          <th scope="col">{messages.statsImportLocalColumn}</th>
          <th scope="col">{messages.statsImportFileColumn}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, localValue, fileValue]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{localValue}</td>
            <td>{fileValue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatsPortability({ locale, onStatsChange }: StatsPortabilityProps) {
  const messages = getMessages(locale);
  const [statusMessage, setStatusMessage] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const cancelImportRef = useRef<HTMLButtonElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);

  // Cancel takes focus, like ConfirmDialog: Enter must not replace by accident.
  useEffect(() => {
    if (pendingImport) cancelImportRef.current?.focus();
  }, [pendingImport]);

  const notify = (message: string) => {
    setStatusMessage(message);
  };

  const handleExport = () => {
    const json = exportPlayerStatsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "kpop-quiz-stats.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const handleFileChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const handleReadError = () => {
      notify(messages.statsImportError);
      input.value = "";
    };
    const reader = new FileReader();
    reader.onload = () => {
      // Nothing is written yet: the player compares and confirms first.
      const result = parsePlayerStatsJson(String(reader.result ?? ""));
      if (result.success) {
        setConfirmingReset(false);
        notify("");
        setPendingImport({ file: result.file, local: loadPlayerStats() });
      } else {
        setPendingImport(null);
        notify(messages.statsImportError);
      }
      input.value = "";
    };
    reader.onerror = handleReadError;
    reader.onabort = handleReadError;
    reader.readAsText(file);
  };

  const handleCancelImport = () => {
    setPendingImport(null);
    importButtonRef.current?.focus();
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    const result = applyPlayerStatsFile(pendingImport.file);
    setPendingImport(null);
    if (result.success) {
      onStatsChange(loadPlayerStats());
      notify(messages.statsImportSuccess);
    } else {
      notify(messages.statsImportError);
    }
    importButtonRef.current?.focus();
  };

  const handleImportKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Escape closes only this confirmation, not the stats window around it.
    e.preventDefault();
    e.stopPropagation();
    handleCancelImport();
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
          ref={importButtonRef}
          onClick={() => fileInputRef.current?.click()}
        >
          {messages.statsImport}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          class="visually-hidden"
          tabindex={-1}
          aria-label={messages.statsImport}
          onChange={handleFileChange}
        />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          ref={resetButtonRef}
          aria-expanded={confirmingReset}
          aria-controls="stats-reset-confirm"
          onClick={() => {
            setPendingImport(null);
            setConfirmingReset(true);
          }}
        >
          {messages.statsReset}
        </button>
      </div>
      {confirmingReset && (
        <div id="stats-reset-confirm" class="stats-reset-confirm">
          <p id="stats-reset-confirm-text">{messages.statsResetConfirm}</p>
          <div class="stats-confirm-actions" role="group" aria-labelledby="stats-reset-confirm-text">
            <button type="button" class="btn btn-ghost btn-sm" onClick={handleConfirmReset}>
              {messages.statsConfirm}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={handleCancelReset}>
              {messages.statsCancel}
            </button>
          </div>
        </div>
      )}
      {pendingImport && (
        <div
          id="stats-import-confirm"
          class="stats-reset-confirm stats-import-confirm"
          role="alertdialog"
          aria-labelledby="stats-import-confirm-title"
          aria-describedby="stats-import-confirm-date stats-import-confirm-warning"
          onKeyDown={handleImportKeyDown}
        >
          <p id="stats-import-confirm-title" class="stats-import-confirm-title">
            {messages.statsImportConfirmTitle}
          </p>
          <p id="stats-import-confirm-date">
            {pendingImport.file.exportedAt
              ? messages.statsImportExportedAt(formatExportedAt(pendingImport.file.exportedAt, locale))
              : messages.statsImportExportedAtUnknown}
          </p>
          <ImportComparison
            local={pendingImport.local.overall}
            file={pendingImport.file.stats.overall}
            locale={locale}
            messages={messages}
          />
          <p id="stats-import-confirm-warning">{messages.statsImportConfirmWarning}</p>
          <div class="stats-confirm-actions" role="group" aria-labelledby="stats-import-confirm-title">
            <button type="button" class="btn btn-ghost btn-sm" onClick={handleConfirmImport}>
              {messages.statsImportConfirmAction}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              ref={cancelImportRef}
              onClick={handleCancelImport}
            >
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
