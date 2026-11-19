import { isQuizSession, type Locale, type QuizSession } from "../lib/quiz-types";
import { groupDataBasePath } from "../lib/group-pages";
import { isWordSearchPuzzle, type WordSearchPuzzle } from "../lib/word-search-types";

export class GroupPageArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Group page artifact ${kind}`);
  }
}

function dataUrl(path: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${path}`;
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new GroupPageArtifactError("invalid");
  }
  if (response.status === 404) throw new GroupPageArtifactError("missing");
  if (!response.ok) throw new GroupPageArtifactError("invalid");
  try {
    return await response.json();
  } catch {
    throw new GroupPageArtifactError("invalid");
  }
}

export async function loadGroupQuizSession(
  slug: string,
  locale: Locale,
  baseUrl?: string,
): Promise<QuizSession> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = `${groupDataBasePath(slug)}/session.${locale}.json`;
  const payload = await fetchJson(dataUrl(filename, effectiveBaseUrl));
  if (!isQuizSession(payload)) throw new GroupPageArtifactError("invalid");
  if (payload.config.group_id == null) throw new GroupPageArtifactError("invalid");
  return payload;
}

export async function loadGroupWordSearch(
  slug: string,
  baseUrl?: string,
): Promise<WordSearchPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = `${groupDataBasePath(slug)}/word-search.json`;
  const payload = await fetchJson(dataUrl(filename, effectiveBaseUrl));
  if (!isWordSearchPuzzle(payload)) throw new GroupPageArtifactError("invalid");
  return payload;
}
