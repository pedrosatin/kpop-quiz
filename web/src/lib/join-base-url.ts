/**
 * Join a Playwright/baseURL origin (possibly with a path prefix) and an
 * absolute site path like `/pt-br/`.
 *
 * Playwright's `page.goto('/pt-br/')` with
 * `baseURL=https://host/kpop-quiz` resolves to `https://host/pt-br/` and
 * drops the repo subdirectory. Resolve against a trailing-slash base so the
 * prefix is preserved. Root bases (`https://kpopquiz.online`, local preview)
 * keep working the same way.
 */
export function joinBaseUrl(baseURL: string, path: string): string {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  const relative = path.startsWith("/") ? `.${path}` : `./${path}`;
  return new URL(relative, base).href;
}
