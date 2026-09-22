import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../lib/quiz-types";
import type { QuizTheme } from "../components/Quiz/url-params";
import type { QuizDecade } from "../components/Quiz/url-params";

export class QuizArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Quiz artifact ${kind}`);
  }
}

type ManifestEntry = { path: string; sha256: string; session_id: string };
type Manifest = {
  schema_version: "kpop-quiz-web-manifest-v2";
  dataset_version: string;
  sessions: Record<string, ManifestEntry>;
};

const HASH = /^[0-9a-f]{64}$/;

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (Object.keys(manifest).sort().join() !== "dataset_version,schema_version,sessions"
    || manifest.schema_version !== "kpop-quiz-web-manifest-v2"
    || typeof manifest.dataset_version !== "string" || !HASH.test(manifest.dataset_version)
    || typeof manifest.sessions !== "object" || manifest.sessions === null || Array.isArray(manifest.sessions)) return false;
  const sessions = manifest.sessions as Record<string, unknown>;
  const validKey = (key: string) => /^(?:daily\.)?(?:pt-BR|en)\.(?:assisted|standard|expert)$/.test(key)
    || /^decade\.(?:1990|2000|2010|2020)\.(?:pt-BR|en)\.(?:assisted|standard|expert)$/.test(key);
  if (!Object.keys(sessions).length || !Object.keys(sessions).every(validKey)) return false;
  return Object.keys(sessions).every((key) => {
    const entry = sessions[key];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    return Object.keys(fields).sort().join() === "path,session_id,sha256"
      && typeof fields.sha256 === "string" && HASH.test(fields.sha256)
      && fields.path === `session.${key}.${fields.sha256}.json`
      && typeof fields.session_id === "string" && HASH.test(fields.session_id);
  });
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface LoadedQuizSession {
  session: QuizSession;
  availableDecades: Exclude<QuizDecade, null>[];
  decade: QuizDecade;
}

function availableDecades(manifest: Manifest): Exclude<QuizDecade, null>[] {
  return ([1990, 2000, 2010, 2020] as const).filter((decade) =>
    (["pt-BR", "en"] as const).every((locale) =>
      (["assisted", "standard", "expert"] as const).every((mode) =>
        Boolean(manifest.sessions[`decade.${decade}.${locale}.${mode}`]))));
}

export async function loadQuizSessionWithAvailability(
  locale: Locale,
  playMode: PlayMode,
  theme: QuizTheme = "history", baseUrl?: string, decade: QuizDecade = null,
): Promise<LoadedQuizSession> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;

  const manifestResponse = await fetch(dataUrl("manifest-v2.json", effectiveBaseUrl));
  if (manifestResponse.status === 404) throw new QuizArtifactError("missing");
  if (!manifestResponse.ok) throw new QuizArtifactError("invalid");
  let manifest: unknown;
  try {
    manifest = await manifestResponse.json();
  } catch {
    throw new QuizArtifactError("invalid");
  }
  if (!isManifest(manifest)) throw new QuizArtifactError("invalid");
  let resolvedDecade = decade;
  let sessionKey = decade === null
    ? (theme === "daily" ? `daily.${locale}.${playMode}` : `${locale}.${playMode}`)
    : `decade.${decade}.${locale}.${playMode}`;
  let entry = manifest.sessions[sessionKey];
  if (!entry && decade !== null) {
    resolvedDecade = null;
    sessionKey = theme === "daily" ? `daily.${locale}.${playMode}` : `${locale}.${playMode}`;
    entry = manifest.sessions[sessionKey];
  }
  if (!entry) throw new QuizArtifactError("missing");
  const response = await fetch(dataUrl(entry.path, effectiveBaseUrl));
  if (response.status === 404) throw new QuizArtifactError("missing");
  if (!response.ok) throw new QuizArtifactError("invalid");
  let payload: unknown;
  try {
    const bytes = await response.arrayBuffer();
    if (await sha256(bytes) !== entry.sha256) throw new QuizArtifactError("invalid");
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new QuizArtifactError("invalid");
  }
  if (!isQuizSession(payload)) throw new QuizArtifactError("invalid");
  if (payload.config.language !== locale || payload.config.play_mode !== playMode
    || (resolvedDecade !== null && payload.config.decade !== resolvedDecade)
    || payload.dataset_version !== manifest.dataset_version
    || payload.session_id !== entry.session_id) throw new QuizArtifactError("invalid");
  return { session: payload, availableDecades: availableDecades(manifest), decade: resolvedDecade };
}

export async function loadQuizSession(
  locale: Locale,
  playMode: PlayMode,
  theme: QuizTheme = "history", baseUrl?: string, decade: QuizDecade = null,
): Promise<QuizSession> {
  const loaded = await loadQuizSessionWithAvailability(locale, playMode, theme, baseUrl, decade);
  return loaded.session;
}


