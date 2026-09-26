import type { Ref } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { MapPilotCountry, MapPilotEvent } from "../../data/map-pilot";
import { mapPilotCountryLabel } from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";

/** How long the result buttons ignore activation after they replace Next. */
export const RESULT_GUARD_MS = 300;

interface ResultCopy {
  complete: string;
  summary: (correct: number, total: number) => string;
  shareLine: (correct: number, total: number) => string;
  restart: string;
  reviewTitle: string;
  right: string;
  wrong: string;
  answerWas: string;
  yourAnswer: string;
  scheduleSource: string;
  openSchedule: string;
  locator: string;
  musicBrainzEvent: string;
  openMusicBrainz: string;
  wikidataCheck: (revision: number) => string;
  checkedAt: (date: string) => string;
  scheduleNote: string;
}

const COPY: Record<Locale, ResultCopy> = {
  "pt-BR": {
    complete: "Rodada concluída",
    summary: (correct, total) => `${correct} de ${total} certas.`,
    shareLine: (correct, total) => `${correct}/${total} datas certas`,
    restart: "Jogar outra rodada",
    reviewTitle: "Datas da rodada",
    right: "Certa",
    wrong: "Errada",
    answerWas: "País correto",
    yourAnswer: "Sua resposta",
    scheduleSource: "Agenda oficial da YG.",
    openSchedule: "Abrir a agenda",
    locator: "Local na fonte:",
    musicBrainzEvent: "Evento no MusicBrainz.",
    openMusicBrainz: "Abrir o evento",
    wikidataCheck: (revision) => `País da área do local no Wikidata, revisão ${revision}.`,
    checkedAt: (date) => `Conferida em ${date}.`,
    scheduleNote: "Cada data aparece na agenda oficial. Isso não confirma que o show aconteceu.",
  },
  en: {
    complete: "Round complete",
    summary: (correct, total) => `${correct} of ${total} right.`,
    shareLine: (correct, total) => `${correct}/${total} dates right`,
    restart: "Play another round",
    reviewTitle: "Dates in this round",
    right: "Right",
    wrong: "Wrong",
    answerWas: "Correct country",
    yourAnswer: "Your answer",
    scheduleSource: "YG official schedule.",
    openSchedule: "Open the schedule",
    locator: "Location in source:",
    musicBrainzEvent: "MusicBrainz event.",
    openMusicBrainz: "Open the event",
    wikidataCheck: (revision) => `Country of the venue's area on Wikidata, revision ${revision}.`,
    checkedAt: (date) => `Checked on ${date}.`,
    scheduleNote: "Each date appears in the official schedule. This does not confirm the show took place.",
  },
};

export function formatMapDate(value: string, locale: Locale, month: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-GB", {
    day: "numeric",
    month,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The place in the YG schedule as a reader would say it: "GOYANG > GOYANG
 * STADIUM > 2025-07-05" becomes "GOYANG, GOYANG STADIUM". The date is
 * dropped because the review line already shows it.
 */
export function readableScheduleLocator(locator: string, eventDate: string): string {
  const parts = locator.split(">").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts[parts.length - 1] === eventDate) parts.pop();
  return parts.join(", ") || locator;
}

export function mapShareText(
  roundDate: string,
  round: readonly MapPilotEvent[],
  answers: readonly string[],
  locale: Locale,
): string {
  const marks = round.map((event, i) => (answers[i] === event.map_feature_id ? "🟩" : "🟥")).join("");
  const correct = round.filter((event, i) => answers[i] === event.map_feature_id).length;
  return `K-pop Map ${roundDate}\n${COPY[locale].shareLine(correct, round.length)}\n${marks}`;
}

export interface MapPilotResultProps {
  roundDate: string;
  round: readonly MapPilotEvent[];
  answers: readonly string[];
  countryByFeature: ReadonlyMap<string, MapPilotCountry>;
  locale: Locale;
  onRestart: () => void;
  onCopied?: () => void;
  onShareFailed?: () => void;
  titleRef?: Ref<HTMLHeadingElement>;
}

/**
 * End of the round, shown in the action bar in place of Next. The bar keeps
 * the score and the buttons; every date with its answers and sources opens
 * below them on request, so the map stays in view.
 */
export function MapPilotResult({
  roundDate,
  round,
  answers,
  countryByFeature,
  locale,
  onRestart,
  onCopied,
  onShareFailed,
  titleRef,
}: MapPilotResultProps) {
  const copy = COPY[locale];
  const messages = getMessages(locale);
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const summaryId = useId();
  const sourceId = useId();
  const shareFailedId = useId();
  const source = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);

  // The buttons appear where Next was, so a second tap or a held Enter
  // meant for the last Next must not share or restart the round.
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, []);
  const guarded = (action: () => void) => () => {
    if (performance.now() - shownAt.current >= RESULT_GUARD_MS) action();
  };
  const ignoreRepeat = (event: KeyboardEvent) => {
    if (event.repeat) event.preventDefault();
  };

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  // The bar stops being sticky while the panel is open, so the panel can
  // open below the fold; bring it into view.
  useEffect(() => {
    if (sourceOpen) source.current?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

  const correct = round.filter((event, i) => answers[i] === event.map_feature_id).length;
  const shareText = mapShareText(roundDate, round, answers, locale);
  const label = (featureId: string | undefined) => {
    const country = featureId ? countryByFeature.get(featureId) : undefined;
    return country ? mapPilotCountryLabel(country, locale) : messages.noAnswer;
  };

  // The share sheet first, where there is one; a player who closes it has not
  // hit an error. Then the clipboard. If neither takes the text, the text
  // shows in a field the player can select and copy by hand.
  const handleShare = async () => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (typeof nav?.share === "function") {
      try {
        await nav.share({ text: shareText });
        return;
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      }
    }
    try {
      if (typeof nav?.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await nav.clipboard.writeText(shareText);
    } catch {
      setShareFailed(true);
      onShareFailed?.();
      return;
    }
    setShareFailed(false);
    setCopied(true);
    onCopied?.();
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, 3000);
  };

  return (
    <section class="map-pilot-result" aria-labelledby={titleId}>
      <div class="map-pilot-verdict">
        <h2
          id={titleId}
          {...(titleRef ? { ref: titleRef } : {})}
          tabIndex={-1}
          aria-describedby={summaryId}
          class="game-actions-title map-pilot-result-title"
        >
          {copy.complete}
        </h2>
        <p id={summaryId} class="map-pilot-result-summary">{copy.summary(correct, round.length)}</p>
      </div>

      <div class="map-pilot-result-buttons">
        <button type="button" class="btn btn-primary" onKeyDown={ignoreRepeat} onClick={guarded(handleShare)}>
          {copied ? messages.copiedToClipboard : messages.share}
        </button>
        <button type="button" class="btn btn-secondary" onKeyDown={ignoreRepeat} onClick={guarded(onRestart)}>
          {copy.restart}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          aria-expanded={sourceOpen}
          aria-controls={sourceId}
          onKeyDown={ignoreRepeat}
          onClick={guarded(() => setSourceOpen((open) => !open))}
        >
          {sourceOpen ? messages.hideSource : messages.showSource}
        </button>
      </div>

      {shareFailed && (
        <div class="map-pilot-share-fallback">
          <p id={shareFailedId}>{messages.shareFailed}</p>
          <textarea
            class="share-preview"
            readOnly
            rows={3}
            value={shareText}
            aria-label={messages.shareTextLabel}
            aria-describedby={shareFailedId}
            onFocus={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
          />
        </div>
      )}

      <div ref={source} id={sourceId} class="map-pilot-source" hidden={!sourceOpen}>
        {sourceOpen && (
          <section class="review-section map-pilot-review" aria-labelledby={`${sourceId}-title`}>
            <h3 id={`${sourceId}-title`} class="review-section-title">{copy.reviewTitle}</h3>
            <p class="map-pilot-review-note">{copy.scheduleNote}</p>
            <ol class="review-list">
              {round.map((event, i) => {
                const isRight = answers[i] === event.map_feature_id;
                return (
                  <li key={event.event_mbid} class={`review-item ${isRight ? "is-correct" : "is-wrong"}`}>
                    <div class="review-item-header">
                      <span class={`badge ${isRight ? "badge-success" : "badge-failure"}`}>
                        {isRight ? copy.right : copy.wrong}
                      </span>
                    </div>
                    <h4 class="review-item-title">{formatMapDate(event.event_date, locale)}</h4>
                    <p>
                      <span class="review-label">{copy.answerWas}: </span>
                      <strong>{label(event.map_feature_id)}</strong>
                    </p>
                    <p>
                      <span class="review-label">{copy.yourAnswer}: </span>
                      <strong class={isRight ? "text-success" : "text-error"}>{label(answers[i])}</strong>
                    </p>
                    <ul class="map-pilot-review-sources">
                      <li>
                        {copy.scheduleSource}{" "}
                        <a href={event.source_url} target="_blank" rel="noreferrer">{copy.openSchedule}</a>
                        <span class="map-pilot-source-locator" title={event.source_locator}>
                          {copy.locator} {readableScheduleLocator(event.source_locator, event.event_date)}
                        </span>
                      </li>
                      <li>
                        {copy.musicBrainzEvent}{" "}
                        <a href={event.musicbrainz_event_url} target="_blank" rel="noreferrer">{copy.openMusicBrainz}</a>
                      </li>
                      <li>
                        {copy.wikidataCheck(event.country_check_wikidata_revid)}{" "}
                        <a
                          href={`https://www.wikidata.org/w/index.php?oldid=${event.country_check_wikidata_revid}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {messages.openRevision("Wikidata")}
                        </a>
                      </li>
                      <li class="map-pilot-source-locator">{copy.checkedAt(formatMapDate(event.source_checked_at, locale, "short"))}</li>
                    </ul>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
    </section>
  );
}
