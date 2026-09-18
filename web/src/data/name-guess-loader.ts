import {
  isNameGuessPuzzle,
  type NameGuessPuzzle,
  type Locale,
} from "../lib/quiz-types";

export class NameGuessArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Name guess artifact ${kind}`);
  }
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

export async function loadNameGuessPuzzle(
  _locale: Locale,
  baseUrl?: string
): Promise<NameGuessPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const targetUrl = dataUrl("name-guess.daily.json", effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new NameGuessArtifactError("invalid");
  }

  if (response.status === 404) {
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

  return payload;
}
