import { useCallback, useEffect, useState } from "preact/hooks";
import type { TimelinePuzzle } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { QuizState } from "../Quiz/QuizState";
import { TimelineArtifactError, loadTimelinePuzzle } from "../../data/timeline-loader";
import { TimelineGameContent } from "./TimelineGameContent";
import type { TimelineGameProps } from "./types";

export function TimelineGame({
  locale,
  baseUrl,
  messages: propMessages,
  puzzle: initialPuzzle,
}: TimelineGameProps) {
  const messages = propMessages ?? getMessages(locale);
  const [loadedPuzzle, setLoadedPuzzle] = useState<TimelinePuzzle | null>(initialPuzzle ?? null);
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
      const data = await loadTimelinePuzzle(locale, baseUrl);
      setLoadedPuzzle(data);
      setStatus("ready");
    } catch (err) {
      setErrorKind(err instanceof TimelineArtifactError ? err.kind : "invalid");
      setStatus("error");
    }
  }, [initialPuzzle, locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return (
      <div id="timeline">
        <QuizState message={messages.loading} busy={true} wide />
      </div>
    );
  }

  if (status === "error" || !loadedPuzzle) {
    const errorMsg = errorKind === "missing" ? messages.artifactMissing : messages.loadError;
    return (
      <div id="timeline">
        <QuizState message={errorMsg} actionLabel={messages.retry} onAction={loadData} wide />
      </div>
    );
  }

  return (
    <TimelineGameContent
      puzzle={loadedPuzzle}
      locale={locale}
    />
  );
}

export type { TimelineGameProps };
