import { useCallback, useEffect, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WordSearchArtifactError, loadWordSearchPuzzle } from "../../data/word-search-loader";
import { WordSearchGameContent } from "./WordSearchGameContent";
import { WORD_SEARCH_I18N, type WordSearchGameProps } from "./types";

export function WordSearchGame({
  puzzle: initialPuzzle,
  locale,
  baseUrl,
}: WordSearchGameProps) {
  const t = WORD_SEARCH_I18N[locale] || WORD_SEARCH_I18N["pt-BR"];
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
        aria-busy="true"
        class="game-card game-card--wide state word-search-state"
      >
        <span class="loader" aria-hidden="true" />
        <p class="loading-message">{t.loading}</p>
      </section>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? t.artifactMissing : t.loadError;
    return (
      <section id="word-search" class="game-card game-card--wide state word-search-state">
        <p class="state-error">{errorMsg}</p>
        <button
          type="button"
          onClick={loadData}
          class="btn btn-primary"
        >
          {t.retry}
        </button>
      </section>
    );
  }

  return <WordSearchGameContent puzzle={loadedPuzzle} locale={locale} />;
}
