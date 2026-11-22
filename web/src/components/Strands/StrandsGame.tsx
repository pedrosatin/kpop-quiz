import { useCallback, useEffect, useState } from "preact/hooks";
import type { StrandsPuzzle } from "../../lib/strands-types";
import {
  StrandsArtifactError,
  type StrandsArtifactKind,
  loadStrandsPuzzle,
} from "../../data/strands-loader";
import { getMessages } from "../../i18n/catalog";
import { StaleDailyNotice } from "../Results/StaleDailyNotice";
import { StrandsGameContent } from "./StrandsGameContent";
import type { StrandsGameProps } from "./types";

/**
 * Loads today's Strands board and shows loading, missing, incompatible,
 * offline and invalid states around it.
 */
export function StrandsGame({
  puzzle: initialPuzzle,
  locale,
  baseUrl,
  daily = true,
  headingLevel = 2,
}: StrandsGameProps) {
  const t = getMessages(locale).strands;
  const [loadedPuzzle, setLoadedPuzzle] = useState<StrandsPuzzle | null>(
    initialPuzzle ?? null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    initialPuzzle ? "ready" : "loading",
  );
  const [errorKind, setErrorKind] = useState<StrandsArtifactKind | undefined>();

  const loadData = useCallback(async () => {
    if (initialPuzzle) {
      setLoadedPuzzle(initialPuzzle);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadStrandsPuzzle(baseUrl);
      setLoadedPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof StrandsArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [initialPuzzle, locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section
        id="strands"
        tabIndex={-1}
        aria-live="polite"
        aria-busy="true"
        class="game-card game-card--wide state strands-state"
        data-testid="strands-loading"
      >
        <span class="loader" aria-hidden="true" />
        <p class="loading-message">{t.loading}</p>
      </section>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const kind = errorKind ?? "invalid";
    const errorMsg =
      kind === "missing"
        ? t.artifactMissing
        : kind === "offline"
          ? t.offline
          : kind === "incompatible"
            ? t.incompatibleVersion
            : t.loadError;
    return (
      <section
        id="strands"
        tabIndex={-1}
        class="game-card game-card--wide state strands-state"
        data-testid="game-missing"
        data-error-kind={kind}
      >
        <p class="state-error">{errorMsg}</p>
        <button
          type="button"
          onClick={loadData}
          class="btn btn-primary"
          data-testid="game-retry"
        >
          {t.retry}
        </button>
      </section>
    );
  }

  return (
    <>
      {daily && <StaleDailyNotice board={loadedPuzzle} locale={locale} />}
      <StrandsGameContent
        puzzle={loadedPuzzle}
        locale={locale}
        daily={daily}
        headingLevel={headingLevel}
      />
    </>
  );
}
