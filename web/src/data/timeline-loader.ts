import {
  isTimelinePuzzle,
  type TimelinePuzzle,
  type Locale,
} from "../lib/quiz-types";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  loadNextDailyWhenMissing,
  preferNextDaily,
} from "./daily-artifact";

export class TimelineArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Timeline artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

export async function loadTimelinePuzzle(
  _locale: Locale,
  baseUrl?: string,
  today: string = dailyReferenceDate()
): Promise<TimelinePuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = "timeline.daily.json";
  const targetUrl = `${dataUrl(filename, effectiveBaseUrl)}?d=${today}`;

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new TimelineArtifactError("invalid");
  }

  if (isMissingDailyResponse(response)) {
    const fromNext = await loadNextDailyWhenMissing(filename, effectiveBaseUrl, isTimelinePuzzle, today);
    if (fromNext) return fromNext;
    throw new TimelineArtifactError("missing");
  }
  if (!response.ok) {
    throw new TimelineArtifactError("invalid");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TimelineArtifactError("invalid");
  }

  if (!isTimelinePuzzle(payload)) {
    throw new TimelineArtifactError("invalid");
  }

  return preferNextDaily(payload, filename, effectiveBaseUrl, isTimelinePuzzle, today);
}
