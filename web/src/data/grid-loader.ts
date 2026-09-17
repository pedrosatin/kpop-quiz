import {
  isIntersectionGrid,
  type IntersectionGrid,
  type Locale,
} from "../lib/quiz-types";

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
  baseUrl?: string
): Promise<IntersectionGrid> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const targetUrl = dataUrl("grid.daily.json", effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new GridArtifactError("invalid");
  }

  if (response.status === 404) {
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

  return payload;
}
