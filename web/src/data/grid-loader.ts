import {
  isIntersectionGrid,
  type IntersectionGrid,
  type Locale,
} from "../lib/quiz-types";
import { dailyReferenceDate, nextDataUrl, preferNextDaily } from "./daily-artifact";

export class GridArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Grid artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

export async function loadIntersectionGrid(
  _locale: Locale,
  baseUrl?: string,
  today: string = dailyReferenceDate()
): Promise<IntersectionGrid> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  // A day can publish without a grid. After the file is removed, the host
  // keeps answering the bare URL with the last deployed copy, so the
  // request carries the reference date to reach the current deployment.
  const targetUrl = `${dataUrl("grid.daily.json", effectiveBaseUrl)}?d=${today}`;

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new GridArtifactError("invalid");
  }

  // Without a 404 page, the host answers a missing file with the site's
  // HTML fallback and status 200.
  if (
    response.status === 404
    || (response.ok && response.headers.get("content-type")?.startsWith("text/html"))
  ) {
    try {
      const nextResponse = await fetch(nextDataUrl("grid.daily.json", effectiveBaseUrl));
      if (
        nextResponse.ok
        && !nextResponse.headers.get("content-type")?.startsWith("text/html")
      ) {
        const payload: unknown = await nextResponse.json();
        if (isIntersectionGrid(payload) && payload.reference_date <= today) {
          return payload;
        }
      }
    } catch {
      // Fallback failed, keep missing error.
    }
    throw new GridArtifactError("missing");
  }
  if (!response.ok) {
    throw new GridArtifactError("invalid");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GridArtifactError("invalid");
  }

  if (!isIntersectionGrid(payload)) {
    throw new GridArtifactError("invalid");
  }

  return preferNextDaily(payload, "grid.daily.json", effectiveBaseUrl, isIntersectionGrid, today);
}
