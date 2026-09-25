import {
  isWordSearchPuzzle,
  type WordSearchPuzzle,
} from "../lib/word-search-types";
import type { Locale } from "../lib/quiz-types";
import { preferNextDaily } from "./daily-artifact";

export class WordSearchArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Word search artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

/**
 * Carrega o artefato diário de caça-palavras temático.
 * O parâmetro _locale é mantido para consistência de interface com os demais carregadores.
 */
export async function loadWordSearchPuzzle(
  _locale: Locale,
  baseUrl?: string
): Promise<WordSearchPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const targetUrl = dataUrl("word-search.daily.json", effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new WordSearchArtifactError("invalid");
  }

  if (response.status === 404) {
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

  return preferNextDaily(payload, "word-search.daily.json", effectiveBaseUrl, isWordSearchPuzzle);
}
