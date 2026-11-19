import { useCallback, useEffect, useState } from "preact/hooks";
import { getMessages } from "../../i18n/catalog";
import { GroupPageArtifactError, loadGroupWordSearch } from "../../data/group-page-loader";
import { groupPagePath } from "../../lib/group-pages";
import { seoAbsoluteUrl } from "../../lib/seo-routes";
import type { Locale } from "../../lib/quiz-types";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WordSearchGame } from "../WordSearch/WordSearchGame";

interface Props {
  slug: string;
  locale: Locale;
  baseUrl?: string;
}

/** Word search island that loads the published group-page puzzle for `slug`. */
export function GroupWordSearch({ slug, locale, baseUrl }: Props) {
  const t = getMessages(locale).wordSearch;
  const [puzzle, setPuzzle] = useState<WordSearchPuzzle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorKind, setErrorKind] = useState<"missing" | "invalid" | undefined>();
  const shareUrl = seoAbsoluteUrl(groupPagePath(slug, locale));

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadGroupWordSearch(slug, baseUrl);
      setPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setPuzzle(null);
      setErrorKind(err instanceof GroupPageArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [slug, baseUrl]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section
        id="group-word-search"
        aria-live="polite"
        aria-busy="true"
        class="game-card game-card--wide state word-search-state"
      >
        <span class="loader" aria-hidden="true" />
        <p class="loading-message">{t.loading}</p>
      </section>
    );
  }

  if (status === "error" || !puzzle) {
    const errorMsg = errorKind === "missing" ? t.artifactMissing : t.loadError;
    return (
      <section
        id="group-word-search"
        class="game-card game-card--wide state word-search-state"
        data-testid="group-word-search-missing"
        data-error-kind={errorKind ?? "invalid"}
      >
        <p class="state-error">{errorMsg}</p>
        <button type="button" onClick={() => void loadData()} class="btn btn-primary" data-testid="game-retry">
          {t.retry}
        </button>
      </section>
    );
  }

  return (
    <div id="group-word-search" data-testid="group-word-search">
      {baseUrl === undefined ? (
        <WordSearchGame
          locale={locale}
          puzzle={puzzle}
          daily={false}
          shareUrl={shareUrl}
          headingLevel={3}
        />
      ) : (
        <WordSearchGame
          locale={locale}
          puzzle={puzzle}
          baseUrl={baseUrl}
          daily={false}
          shareUrl={shareUrl}
          headingLevel={3}
        />
      )}
    </div>
  );
}
