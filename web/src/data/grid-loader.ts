import { isIntersectionGrid, type IntersectionGrid, type Locale } from "../lib/quiz-types";
import { dailyReferenceDate } from "./daily-artifact";
import { isGridPublication, isPublicationDate, type GridPublication } from "./grid-publication";

export class GridArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Grid artifact ${kind}`);
  }
}

function missing(response: Response): boolean {
  return response.status === 404 || (response.ok && !!response.headers.get("content-type")?.startsWith("text/html"));
}

async function readPublication(url: string, today: string): Promise<GridPublication | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (missing(response)) return null; // Legacy deployments have no sidecar.
  if (!response.ok) throw new GridArtifactError("invalid");
  const value: unknown = await response.json();
  if (!isGridPublication(value) || value.reference_date !== today) throw new GridArtifactError("invalid");
  return value;
}

async function readGrid(url: string): Promise<IntersectionGrid | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (missing(response)) return null;
  if (!response.ok) throw new GridArtifactError("invalid");
  const payload: unknown = await response.json();
  if (!isIntersectionGrid(payload)) throw new GridArtifactError("invalid");
  return payload;
}

function admitted(grid: IntersectionGrid | null, authority: GridPublication | null, today: string): grid is IntersectionGrid {
  if (!grid || grid.reference_date > today) return false;
  if (!authority) return true;
  return grid.grid_id === authority.grid_id && grid.reference_date === authority.grid_reference_date;
}

async function loadAuthority(root: string, day: string, today: string): Promise<GridPublication | null> {
  const marker = `grid-publication.${day}.json?d=${today}`;
  return await readPublication(root + marker, day)
    ?? await readPublication(`${root}next/${marker}`, day);
}

async function authorityForGrid(root: string, grid: IntersectionGrid | null, authority: GridPublication | null, today: string) {
  if (!grid || grid.reference_date >= today) return authority;
  const origin = await loadAuthority(root, grid.reference_date, today);
  // Reuse permission cannot revoke the origin's rejection of this identity.
  if (origin && !admitted(grid, origin, today)) return origin;
  return authority ?? origin;
}

export async function loadIntersectionGrid(
  _locale: Locale,
  baseUrl?: string,
  today: string = dailyReferenceDate(),
): Promise<IntersectionGrid & { corrected: boolean }> {
  try {
    if (!isPublicationDate(today)) throw new GridArtifactError("invalid");
    const base = baseUrl ?? import.meta.env.BASE_URL;
    const root = `${base.endsWith("/") ? base : `${base}/`}data/`;
    const authority = await loadAuthority(root, today, today);
    if (authority?.grid_id === null) throw new GridArtifactError("missing");
    const current = await readGrid(`${root}grid.daily.json?d=${today}`);
    const currentAuthority = await authorityForGrid(root, current, authority, today);
    let selected = admitted(current, currentAuthority, today) ? current : null;
    let selectedAuthority = currentAuthority;
    if (!selected || selected.reference_date < today) {
      try {
        const next = await readGrid(`${root}next/grid.daily.json`);
        const nextAuthority = await authorityForGrid(root, next, authority, today);
        if (admitted(next, nextAuthority, today) && (!selected || next.reference_date > selected.reference_date)) {
          selected = next;
          selectedAuthority = nextAuthority;
        }
      } catch (error) {
        // A missing/invalid next candidate can keep an admitted main grid.
        if (!selected && authority) throw error;
      }
    }
    if (!selected) throw new GridArtifactError("missing");
    return { ...selected, corrected: selectedAuthority?.reference_date === today && selectedAuthority.replaces.length > 0 };
  } catch (error) {
    if (error instanceof GridArtifactError) throw error;
    throw new GridArtifactError("invalid");
  }
}
