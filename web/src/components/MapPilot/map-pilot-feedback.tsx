import type { MapPilotCountry, MapPilotEvent } from "../../data/map-pilot";
import { mapPilotCountryLabel } from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { formatMapDate } from "./MapPilotResult";
import type { MapPilotCopy } from "./map-pilot-copy";

export type ShareNotice = { kind: "copied" | "shareFailed"; n: number };

export type AnswerState = "correct" | "incorrect" | null;

export function mapPilotBarState(answerState: AnswerState): string {
  return answerState ? ` is-${answerState}` : "";
}

export function MapPilotFeedbackMessage({
  isComplete,
  answerState,
  current,
  answerCountry,
  selectedCountry,
  pickPrompt,
  notice,
  locale,
  copy,
  messages,
}: {
  isComplete: boolean;
  answerState: AnswerState;
  current: MapPilotEvent | undefined;
  answerCountry: MapPilotCountry | undefined;
  selectedCountry: MapPilotCountry | undefined;
  pickPrompt: number;
  notice: ShareNotice | null;
  locale: Locale;
  copy: MapPilotCopy;
  messages: Messages;
}) {
  if (isComplete) {
    // A new key replaces the paragraph, so a second copy is announced again.
    if (notice) {
      return <p key={notice.n}>{notice.kind === "copied" ? messages.copiedToClipboard : messages.shareFailed}</p>;
    }
    return null;
  }

  if (answerState && current && answerCountry) {
    return (
      <>
        <p class="game-actions-title">{answerState === "correct" ? copy.correct : copy.incorrect}</p>
        <p>
          {selectedCountry && answerState === "incorrect" && <>{copy.yourAnswer}: <strong>{mapPilotCountryLabel(selectedCountry, locale)}</strong> · </>}
          {copy.answerWas}: <strong>{mapPilotCountryLabel(answerCountry, locale)}</strong>
        </p>
        <p class="map-pilot-evidence">
          <a href={current.source_url} target="_blank" rel="noreferrer">{copy.evidence}</a>
          <a href={current.musicbrainz_event_url} target="_blank" rel="noreferrer">{copy.musicBrainz}</a>
          <span>{copy.checkedAt(formatMapDate(current.source_checked_at, locale, "short"))} {copy.scheduleNote}</span>
        </p>
      </>
    );
  }

  if (pickPrompt > 0) {
    // A new key replaces the paragraph, so a second empty Answer is announced again.
    return <p key={pickPrompt} class="game-actions-hint">{copy.pickFirst}</p>;
  }

  return <p class="game-actions-hint">{copy.instructions}</p>;
}
