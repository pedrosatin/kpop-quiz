import { useCallback, useEffect, useState } from "preact/hooks";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { NameGuessArtifactError, loadNameGuessPuzzle } from "../../data/name-guess-loader";
import { NameGuessGameContent } from "./NameGuessGameContent";
import { NAME_GUESS_I18N, type NameGuessGameProps } from "./types";

export function NameGuessGame({ puzzle: initialPuzzle, locale, baseUrl }: NameGuessGameProps) {
  const t = NAME_GUESS_I18N[locale] || NAME_GUESS_I18N["pt-BR"];
  const [loadedPuzzle, setLoadedPuzzle] = useState<NameGuessPuzzle | null>(initialPuzzle ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(initialPuzzle ? "ready" : "loading");
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
      const data = await loadNameGuessPuzzle(locale, baseUrl);
      setLoadedPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof NameGuessArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [initialPuzzle, locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section id="name-guess" aria-live="polite" aria-busy="true" class="game-card state">
        <span class="loader" aria-hidden="true" />
        <p class="text-muted">{t.loading}</p>
      </section>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? t.artifactMissing : t.loadError;
    return (
      <section id="name-guess" class="game-card state">
        <p class="state-error">{errorMsg}</p>
        <button type="button" onClick={loadData} class="btn btn-primary">
          {t.retry}
        </button>
      </section>
    );
  }

  return <NameGuessGameContent puzzle={loadedPuzzle} locale={locale} t={t} />;
}
