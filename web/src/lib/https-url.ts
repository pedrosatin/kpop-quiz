/**
 * The one check for URLs that come from published data. A prefix test such
 * as `startsWith("https://")` reads the raw string, while the browser parses
 * it: parsing here is what makes the check agree with the link the player
 * gets. Credentials are not refused here; `sourceTarget` refuses to link them.
 */

/** The URL, parsed, when it is absolute https with a host; null otherwise. */
export function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** Whether a published value is an absolute https URL with a host. */
export function isHttpsUrl(value: unknown): value is string {
  return parseHttpsUrl(value) !== null;
}
