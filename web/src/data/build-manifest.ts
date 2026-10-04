import fs from "node:fs";
import path from "node:path";
import type { QuizDecadeValue } from "../components/Quiz/url-params";
import { availableDecadesFromManifest } from "./session-loader";

/**
 * Build-time only: reads the published manifest so the server-rendered setup
 * includes the decade picker. The client still validates the
 * manifest it fetches; a missing or invalid file here only hides the picker
 * until that fetch completes.
 */
export function initialQuizDecades(): QuizDecadeValue[] {
  try {
    const file = path.resolve(process.cwd(), "public/data/manifest-v2.json");
    return availableDecadesFromManifest(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch {
    return [];
  }
}
