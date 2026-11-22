import {
  isNameGuessPuzzle,
  type NameGuessPuzzle,
} from "../lib/quiz-types";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  loadNextDailyWhenMissing,
  preferNextDaily,
} from "./daily-artifact";

export class NameGuessArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Name guess artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

/** Carrega o artefato diário de adivinhação de nomes. */
export async function loadNameGuessPuzzle(
  baseUrl?: string,
  today: string = dailyReferenceDate(),
): Promise<NameGuessPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = "name-guess.daily.json";
  const targetUrl = dataUrl(filename, effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new NameGuessArtifactError("invalid");
  }

  if (isMissingDailyResponse(response)) {
    const fromNext = await loadNextDailyWhenMissing(filename, effectiveBaseUrl, isNameGuessPuzzle, today);
    if (fromNext) return fromNext;
    throw new NameGuessArtifactError("missing");
  }
  if (!response.ok) {
    throw new NameGuessArtifactError("invalid");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NameGuessArtifactError("invalid");
  }

  if (!isNameGuessPuzzle(payload)) {
    throw new NameGuessArtifactError("invalid");
  }

  return preferNextDaily(payload, filename, effectiveBaseUrl, isNameGuessPuzzle, today);
}
