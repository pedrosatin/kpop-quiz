import { useCallback, useEffect, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { CodeGroupsArtifactError, loadCodeGroupsPuzzle, type CodeGroupsPuzzle } from "../../data/code-groups";
import { CodeGroupsGameContent } from "./CodeGroupsGameContent";

export function CodeGroupsGame({ locale, baseUrl }: { locale: Locale; baseUrl?: string }) {
  const messages = getMessages(locale);
  const [puzzle, setPuzzle] = useState<CodeGroupsPuzzle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorKind, setErrorKind] = useState<"missing" | "invalid" | undefined>();

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorKind(undefined);
    try {
      setPuzzle(await loadCodeGroupsPuzzle(locale, baseUrl));
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof CodeGroupsArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [locale, baseUrl]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <section id="code-groups" class="game-card game-card--wide state" aria-live="polite" aria-busy="true">
        <span class="loader" aria-hidden="true" />
        <p class="text-muted">{messages.loading}</p>
      </section>
    );
  }

  if (status === "error" || !puzzle) {
    // The daily artifact is a partial publish: a generation failure leaves
    // the day without the file, so missing keeps its own copy for the player.
    const errorMsg = errorKind === "missing" ? messages.codeArtifactMissing : messages.loadError;
    return (
      <section
        id="code-groups"
        class="game-card game-card--wide state"
        data-testid="game-missing"
        aria-live="polite"
      >
        <p class="state-error">{errorMsg}</p>
        <button type="button" class="btn btn-primary" data-testid="game-retry" onClick={() => { void loadData(); }}>
          {messages.retry}
        </button>
      </section>
    );
  }

  return <CodeGroupsGameContent puzzle={puzzle} locale={locale} messages={messages} />;
}
