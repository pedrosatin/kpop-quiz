import { useCallback, useEffect, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WordSearchArtifactError, loadWordSearchPuzzle } from "../../data/word-search-loader";
import { WordSearchGameContent } from "./WordSearchGameContent";
import { getMessages } from "../../i18n/catalog";
import type { WordSearchGameProps } from "./types";

export function WordSearchGame({
  puzzle: initialPuzzle,
  locale,
  baseUrl,
}: WordSearchGameProps) {
  const t = getMessages(locale).wordSearch;
  const [loadedPuzzle, setLoadedPuzzle] = useState<WordSearchPuzzle | null>(
    initialPuzzle ?? null
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    initialPuzzle ? "ready" : "loading"
  );
  const [errorKind, setErrorKind] = useState<"missing" | "invalid" | undefined>();

  const loadData = useCallback(async () => {
    if (initialPuzzle) {
      setLoadedPuzzle(initialPuzzle);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadWordSearchPuzzle(locale, baseUrl);
      setLoadedPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof WordSearchArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [initialPuzzle, locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section
        id="word-search"
        aria-live="polite"
        class="word-search-loading-container"
      >
        <span class="loader" aria-hidden="true" />
        <p class="loading-message">{t.loading}</p>
      </section>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? t.artifactMissing : t.loadError;
    return (
      <section id="word-search" class="word-search-error-container">
        <p class="error-message">{errorMsg}</p>
        <button
          type="button"
          onClick={loadData}
          class="retry-btn primary-btn"
        >
          {t.retry}
        </button>
      </section>
    );
  }

  return <WordSearchGameContent puzzle={loadedPuzzle} locale={locale} />;
}
