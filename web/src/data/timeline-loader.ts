import {
  isTimelinePuzzle,
  type TimelinePuzzle,
  type Locale,
} from "../lib/quiz-types";
import { dailyReferenceDate, nextDataUrl, preferNextDaily } from "./daily-artifact";

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
  const targetUrl = `${dataUrl("timeline.daily.json", effectiveBaseUrl)}?d=${today}`;

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new TimelineArtifactError("invalid");
  }

  if (
    response.status === 404
    || (response.ok && response.headers.get("content-type")?.startsWith("text/html"))
  ) {
    try {
      const nextResponse = await fetch(nextDataUrl("timeline.daily.json", effectiveBaseUrl));
      if (
        nextResponse.ok
        && !nextResponse.headers.get("content-type")?.startsWith("text/html")
      ) {
        const payload: unknown = await nextResponse.json();
        if (isTimelinePuzzle(payload) && payload.reference_date <= today) {
          return payload;
        }
      }
    } catch {
      // Fallback failed, keep missing error.
    }
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

  return preferNextDaily(payload, "timeline.daily.json", effectiveBaseUrl, isTimelinePuzzle, today);
}
