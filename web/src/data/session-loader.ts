import { isQuizSession, type Locale, type PlayMode, type QuizSession } from "../lib/quiz-types";
import type { QuizTheme } from "../components/Quiz/url-params";
import type { QuizDecadeSelection, QuizDecadeValue } from "../components/Quiz/url-params";
import { dailyReferenceDate } from "./daily-artifact";

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
  availableDecades: QuizDecadeValue[];
  decades: QuizDecadeSelection;
}

function availableDecades(manifest: Manifest): QuizDecadeValue[] {
  return ([1990, 2000, 2010, 2020] as const).filter((decade) =>
    (["pt-BR", "en"] as const).every((locale) =>
      (["assisted", "standard", "expert"] as const).every((mode) =>
        Boolean(manifest.sessions[`decade.${decade}.${locale}.${mode}`]))));
}

const DECADES = [1990, 2000, 2010, 2020] as const;

async function readSession(entry: ManifestEntry, manifest: Manifest, locale: Locale, playMode: PlayMode, decade: QuizDecadeValue | null, baseUrl: string, dir = ""): Promise<QuizSession> {
  const response = await fetch(dataUrl(`${dir}${entry.path}`, baseUrl));
  if (response.status === 404) throw new QuizArtifactError("missing");
  if (!response.ok) throw new QuizArtifactError("invalid");
  let payload: unknown;
  try {
    const bytes = await response.arrayBuffer();
    if (await sha256(bytes) !== entry.sha256) throw new QuizArtifactError("invalid");
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof QuizArtifactError) throw error;
    throw new QuizArtifactError("invalid");
  }
  if (!isQuizSession(payload)) throw new QuizArtifactError("invalid");
  if (payload.config.language !== locale || payload.config.play_mode !== playMode
    || (decade !== null && payload.config.decade !== decade)
    || payload.dataset_version !== manifest.dataset_version
    || payload.session_id !== entry.session_id) throw new QuizArtifactError("invalid");
  return payload;
}

const DAILY_SEED = /^kpop-daily-(\d{4}-\d{2}-\d{2})$/;

function dailySessionDate(session: QuizSession): string | null {
  return DAILY_SEED.exec(session.config.seed)?.[1] ?? null;
}

// Daily sessions for the next day are published ahead under data/next/.
// See daily-artifact.ts.
async function nextDailySession(current: QuizSession, sessionKey: string, locale: Locale, playMode: PlayMode, baseUrl: string): Promise<QuizSession | null> {
  const today = dailyReferenceDate();
  const currentDate = dailySessionDate(current);
  if (currentDate === null || currentDate >= today) return null;
  try {
    const response = await fetch(dataUrl("next/manifest-v2.json", baseUrl));
    if (!response.ok) return null;
    const manifest: unknown = await response.json();
    if (!isManifest(manifest)) return null;
    const entry = manifest.sessions[sessionKey];
    if (!entry) return null;
    const session = await readSession(entry, manifest, locale, playMode, null, baseUrl, "next/");
    const nextDate = dailySessionDate(session);
    return nextDate !== null && nextDate > currentDate && nextDate <= today ? session : null;
  } catch {
    return null;
  }
}

async function combineSessions(sessions: QuizSession[], decades: QuizDecadeValue[]): Promise<QuizSession> {
  const questions = [] as QuizSession["questions"];
  const seenIds = new Set<string>();
  const seenSemanticIds = new Set<string>();
  const questionCount = Math.max(...sessions.map(({ questions: items }) => items.length));
  for (let index = 0; index < questionCount && questions.length < 10; index += 1) {
    for (const session of sessions) {
      const question = session.questions[index];
      if (!question) continue;
      if (seenIds.has(question.id) || seenSemanticIds.has(question.semantic_id)) continue;
      seenIds.add(question.id);
      seenSemanticIds.add(question.semantic_id);
      questions.push(question);
      if (questions.length === 10) break;
    }
  }
  if (questions.length !== 10) throw new QuizArtifactError("invalid");
  const identity = JSON.stringify({
    dataset_version: sessions[0]!.dataset_version,
    decades,
    source_sessions: sessions.map(({ session_id }) => session_id),
    question_ids: questions.map(({ id }) => id),
  });
  const id = await sha256(new TextEncoder().encode(identity).buffer);
  return {
    ...sessions[0]!,
    session_id: id,
    config: { ...sessions[0]!.config, decade: null, seed: id },
    questions,
  };
}

export async function loadQuizSessionWithAvailability(
  locale: Locale,
  playMode: PlayMode,
  theme: QuizTheme = "history", baseUrl?: string, decades: readonly QuizDecadeValue[] = [],
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
  const selected = [...new Set(decades)].filter((decade) => DECADES.includes(decade)).sort((a, b) => a - b);
  const available = availableDecades(manifest);
  if (selected.length) {
    const resolved = selected.filter((decade) => Boolean(manifest.sessions[`decade.${decade}.${locale}.${playMode}`]));
    if (resolved.length) {
      const sessions = await Promise.all(resolved.map((decade) => readSession(
        manifest.sessions[`decade.${decade}.${locale}.${playMode}`]!, manifest, locale, playMode, decade, effectiveBaseUrl,
      )));
      const session = sessions.length === 1 ? sessions[0]! : await combineSessions(sessions, resolved);
      return { session, availableDecades: available, decades: resolved };
    }
  }
  const sessionKey = theme === "daily" ? `daily.${locale}.${playMode}` : `${locale}.${playMode}`;
  const entry = manifest.sessions[sessionKey];
  if (!entry) throw new QuizArtifactError("missing");
  const session = await readSession(entry, manifest, locale, playMode, null, effectiveBaseUrl);
  const next = theme === "daily" ? await nextDailySession(session, sessionKey, locale, playMode, effectiveBaseUrl) : null;
  return { session: next ?? session, availableDecades: available, decades: [] };
}

export async function loadQuizSession(
  locale: Locale,
  playMode: PlayMode,
  theme: QuizTheme = "history", baseUrl?: string, decades: readonly QuizDecadeValue[] = [],
): Promise<QuizSession> {
  const loaded = await loadQuizSessionWithAvailability(locale, playMode, theme, baseUrl, decades);
  return loaded.session;
}
