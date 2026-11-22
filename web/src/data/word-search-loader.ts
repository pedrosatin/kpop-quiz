import {
  isWordSearchPuzzle,
  type WordSearchPuzzle,
} from "../lib/word-search-types";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  loadNextDailyWhenMissing,
  preferNextDaily,
} from "./daily-artifact";

export class WordSearchArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Word search artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

/** Carrega o artefato diário de caça-palavras temático. */
export async function loadWordSearchPuzzle(
  baseUrl?: string,
  today: string = dailyReferenceDate(),
): Promise<WordSearchPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = "word-search.daily.json";
  const targetUrl = dataUrl(filename, effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new WordSearchArtifactError("invalid");
  }

  if (isMissingDailyResponse(response)) {
    const fromNext = await loadNextDailyWhenMissing(filename, effectiveBaseUrl, isWordSearchPuzzle, today);
    if (fromNext) return fromNext;
    throw new WordSearchArtifactError("missing");
  }
  if (!response.ok) {
    throw new WordSearchArtifactError("invalid");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WordSearchArtifactError("invalid");
  }

  if (!isWordSearchPuzzle(payload)) {
    throw new WordSearchArtifactError("invalid");
  }

  return preferNextDaily(payload, filename, effectiveBaseUrl, isWordSearchPuzzle, today);
}
