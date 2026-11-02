/** Publication authority is separate from the unchanged grid-v1 payload. */
export interface GridPublication {
  schema_version: "kpop-grid-publication-v1";
  reference_date: string;
  grid_id: string | null;
  grid_reference_date: string | null;
  replaces: string[];
}

export function isPublicationDate(value: unknown): value is string {
  if (typeof value !== "string" || (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isGridPublication(value: unknown): value is GridPublication {
  if (typeof value !== "object" || value === null) return false;
  const p = value as GridPublication;
  if (Object.keys(p).sort().join(",") !== "grid_id,grid_reference_date,reference_date,replaces,schema_version") return false;
  if (p.schema_version !== "kpop-grid-publication-v1" || !isPublicationDate(p.reference_date)) return false;
  if (!Array.isArray(p.replaces) || !p.replaces.every(isHash)) return false;
  if (new Set(p.replaces).size !== p.replaces.length || p.replaces.includes(p.grid_id as string)) return false;
  if (p.grid_id === null) return p.grid_reference_date === null;
  if (!isHash(p.grid_id) || !isPublicationDate(p.grid_reference_date)) return false;
  if (p.grid_reference_date > p.reference_date) return false;
  return p.replaces.length === 0 || p.grid_reference_date === p.reference_date;
}
