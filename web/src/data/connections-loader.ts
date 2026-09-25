import {
  isConnectionsPuzzle,
  type ConnectionsPuzzle,
  type Locale,
} from "../lib/quiz-types";
import { preferNextDaily } from "./daily-artifact";

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
  _locale: Locale,
  baseUrl?: string
): Promise<ConnectionsPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const targetUrl = dataUrl("connections.daily.json", effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new ConnectionsArtifactError("invalid");
  }

  if (response.status === 404) {
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

  return preferNextDaily(payload, "connections.daily.json", effectiveBaseUrl, isConnectionsPuzzle);
}
