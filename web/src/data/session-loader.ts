import { isQuizSession, type Locale, type QuizSession } from "../lib/quiz-types";

export class QuizArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Quiz artifact ${kind}`);
  }
}

type ManifestEntry = { path: string; sha256: string; session_id: string };
type Manifest = {
  schema_version: "kpop-quiz-web-manifest-v1";
  dataset_version: string;
  sessions: Record<Locale, ManifestEntry>;
};

const HASH = /^[0-9a-f]{64}$/;

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (Object.keys(manifest).sort().join() !== "dataset_version,schema_version,sessions"
    || manifest.schema_version !== "kpop-quiz-web-manifest-v1"
    || typeof manifest.dataset_version !== "string" || !HASH.test(manifest.dataset_version)
    || typeof manifest.sessions !== "object" || manifest.sessions === null || Array.isArray(manifest.sessions)) return false;
  const sessions = manifest.sessions as Record<string, unknown>;
  if (Object.keys(sessions).sort().join() !== "en,pt-BR") return false;
  return (["pt-BR", "en"] as const).every((locale) => {
    const entry = sessions[locale];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    return Object.keys(fields).sort().join() === "path,session_id,sha256"
      && typeof fields.sha256 === "string" && HASH.test(fields.sha256)
      && fields.path === `session.${locale}.${fields.sha256}.json`
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

export async function loadQuizSession(locale: Locale, baseUrl = import.meta.env.BASE_URL): Promise<QuizSession> {
  const manifestResponse = await fetch(dataUrl("manifest.json", baseUrl));
  if (manifestResponse.status === 404) throw new QuizArtifactError("missing");
  if (!manifestResponse.ok) throw new QuizArtifactError("invalid");
  let manifest: unknown;
  try {
    manifest = await manifestResponse.json();
  } catch {
    throw new QuizArtifactError("invalid");
  }
  if (!isManifest(manifest)) throw new QuizArtifactError("invalid");
  const entry = manifest.sessions[locale];
  const response = await fetch(dataUrl(entry.path, baseUrl));
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
  if (payload.config.language !== locale
    || payload.dataset_version !== manifest.dataset_version
    || payload.session_id !== entry.session_id) throw new QuizArtifactError("invalid");
  return payload;
}
