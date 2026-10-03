import { useCallback, useEffect, useState } from "preact/hooks";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { QuizState } from "../Quiz/QuizState";
import { ConnectionsArtifactError, loadConnectionsPuzzle } from "../../data/connections-loader";
import type { ConnectionsGameProps } from "./types";
import { ConnectionsGameContent, SUBMIT_GUARD_MS } from "./ConnectionsGameContent";

export { SUBMIT_GUARD_MS };

export function ConnectionsGame({
  locale,
  baseUrl,
  messages: propMessages,
  puzzle: initialPuzzle,
}: ConnectionsGameProps) {
  const messages = propMessages ?? getMessages(locale);
  const [loadedPuzzle, setLoadedPuzzle] = useState<ConnectionsPuzzle | null>(initialPuzzle ?? null);
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
      const data = await loadConnectionsPuzzle(locale, baseUrl);
      setLoadedPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof ConnectionsArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [initialPuzzle, locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <div id="connections">
        <QuizState message={messages.loading} busy={true} wide />
      </div>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? messages.artifactMissing : messages.loadError;
    return (
      <div id="connections">
        <QuizState message={errorMsg} actionLabel={messages.retry} onAction={loadData} wide />
      </div>
    );
  }

  return (
    <ConnectionsGameContent
      puzzle={loadedPuzzle}
      locale={locale}
      messages={messages}
      onReload={loadData}
    />
  );
}
