import {
  isConnectionsPuzzle,
  type ConnectionsPuzzle,
} from "../lib/quiz-types";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  loadNextDailyWhenMissing,
  preferNextDaily,
} from "./daily-artifact";

export class ConnectionsArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Connections artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

export async function loadConnectionsPuzzle(
  baseUrl?: string,
  today: string = dailyReferenceDate(),
): Promise<ConnectionsPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = "connections.daily.json";
  const targetUrl = dataUrl(filename, effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new ConnectionsArtifactError("invalid");
  }

  if (isMissingDailyResponse(response)) {
    const fromNext = await loadNextDailyWhenMissing(filename, effectiveBaseUrl, isConnectionsPuzzle, today);
    if (fromNext) return fromNext;
    throw new ConnectionsArtifactError("missing");
  }
  if (!response.ok) {
    throw new ConnectionsArtifactError("invalid");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConnectionsArtifactError("invalid");
  }

  if (!isConnectionsPuzzle(payload)) {
    throw new ConnectionsArtifactError("invalid");
  }

  return preferNextDaily(payload, filename, effectiveBaseUrl, isConnectionsPuzzle, today);
}
