import { useCallback, useEffect, useState } from "preact/hooks";
import { CrosswordArtifactError, loadCrosswordPuzzle, type CrosswordErrorKind, type CrosswordPuzzle } from "../../data/crossword";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { CrosswordGameContent } from "./CrosswordGameContent";

/** Loads today's board and shows the loading, missing, omitted, unavailable and error states around it. */
export function CrosswordGame({ locale, baseUrl }: { locale: Locale; baseUrl?: string }) {
  const messages = getMessages(locale);
  const [puzzle, setPuzzle] = useState<CrosswordPuzzle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorKind, setErrorKind] = useState<CrosswordErrorKind | undefined>();

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorKind(undefined);
    try {
      setPuzzle(await loadCrosswordPuzzle(baseUrl));
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof CrosswordArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section id="crossword" tabIndex={-1} class="game-card game-card--wide state" aria-live="polite" aria-busy="true">
        <span class="loader" aria-hidden="true" />
        <p class="text-muted">{messages.loading}</p>
      </section>
    );
  }

  if (status === "error" || !puzzle) {
    // No fallback board: a missing, omitted, unavailable or invalid day never
    // plays an earlier board in its place.
    const kind = errorKind ?? "invalid";
    const errorMsg = {
      omitted: messages.crosswordOmitted,
      unavailable: messages.crosswordUnavailable,
      missing: messages.crosswordArtifactMissing,
      invalid: messages.loadError,
    }[kind];
    // data-error-kind lets the boot smoke tell an expected empty day from a broken artifact.
    return (
      <section id="crossword" tabIndex={-1} class="game-card game-card--wide state" data-testid="game-missing" data-error-kind={kind} aria-live="polite">
        <p class="state-error">{errorMsg}</p>
        <button type="button" class="btn btn-primary" data-testid="game-retry" onClick={() => { void loadData(); }}>
          {messages.retry}
        </button>
      </section>
    );
  }

  return <CrosswordGameContent puzzle={puzzle} locale={locale} messages={messages} />;
}
