import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(import.meta.dirname, "../..");
const DATA_ROOT = join(WEB_ROOT, "public/data");
const SCHEMAS_ROOT = join(WEB_ROOT, "../schemas");
const ARTIFACT_MAP_PATH = join(SCHEMAS_ROOT, "artifact-map.json");

type ArtifactMap = {
  by_basename: Record<string, string>;
  patterns: Array<{ regex: string; schema?: string; list_entry?: string }>;
  without_schema: string[];
  map_pilot_prefix: string;
};

const artifactMap = JSON.parse(readFileSync(ARTIFACT_MAP_PATH, "utf8")) as ArtifactMap;

const ARTIFACTS_WITHOUT_SCHEMA: readonly string[] = artifactMap.without_schema;

type Resolution =
  | { kind: "schema"; schemaFile: string }
  | { kind: "unschemaed"; listEntry: string }
  | { kind: "unknown" };

function resolveArtifact(relativePath: string): Resolution {
  const base = basename(relativePath);
  const prefix = artifactMap.map_pilot_prefix;
  const underMapPilot = relativePath === prefix || relativePath.startsWith(`${prefix}/`);

  if (underMapPilot) {
    return { kind: "unschemaed", listEntry: "map-pilot/**" };
  }
  if (artifactMap.by_basename[base]) {
    return { kind: "schema", schemaFile: artifactMap.by_basename[base] };
  }
  const exactWithout = artifactMap.without_schema.filter(
    (entry) => !entry.includes("*") && !entry.includes("<"),
  );
  if (exactWithout.includes(base)) {
    return { kind: "unschemaed", listEntry: base };
  }
  for (const pattern of artifactMap.patterns) {
    if (!new RegExp(pattern.regex).test(base)) continue;
    if (pattern.schema) {
      return { kind: "schema", schemaFile: pattern.schema };
    }
    if (pattern.list_entry) {
      return { kind: "unschemaed", listEntry: pattern.list_entry };
    }
  }
  return { kind: "unknown" };
}

function listJsonFiles(dir: string, baseDir: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsonFiles(full, baseDir));
      continue;
    }
    if (entry.endsWith(".json")) {
      out.push(relative(baseDir, full));
    }
  }
  return out.sort();
}

function loadSchema(schemaFile: string): object {
  return JSON.parse(readFileSync(join(SCHEMAS_ROOT, schemaFile), "utf8")) as object;
}

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const entry of readdirSync(SCHEMAS_ROOT)) {
    if (!entry.endsWith(".json") || entry === "artifact-map.json") continue;
    const schema = loadSchema(entry) as { $id?: string };
    if (!schema.$id) {
      schema.$id = entry;
    }
    ajv.addSchema(schema, entry);
  }
  return ajv;
}

describe("published JSON under public/data vs schemas/ (ADR 053)", () => {
  const relativePaths = listJsonFiles(DATA_ROOT);
  const withSchema: Array<{ relativePath: string; schemaFile: string }> = [];
  const withoutSchema: Array<{ relativePath: string; listEntry: string }> = [];
  const unknown: string[] = [];

  for (const relativePath of relativePaths) {
    const resolution = resolveArtifact(relativePath);
    if (resolution.kind === "schema") {
      withSchema.push({ relativePath, schemaFile: resolution.schemaFile });
    } else if (resolution.kind === "unschemaed") {
      withoutSchema.push({ relativePath, listEntry: resolution.listEntry });
    } else {
      unknown.push(relativePath);
    }
  }

  it("maps every published JSON to a schema or names it in ARTIFACTS_WITHOUT_SCHEMA", () => {
    expect(unknown, `artefatos novos sem mapa nem lista: ${unknown.join(", ")}`).toEqual([]);
  });

  it("matches ARTIFACTS_WITHOUT_SCHEMA to the ADR 053 allow-list", () => {
    expect([...ARTIFACTS_WITHOUT_SCHEMA].sort()).toEqual(
      [
        "catalog-manifest-v1.json",
        "catalog.<locale>.<mode>.<sha256>.json",
        "crossword-publication.<date>.json",
        "daily-set.json",
        "manifest-v2.json",
        "manifest-v3.json",
        "manifest.json",
        "map-pilot/**",
      ].sort(),
    );
  });

  it("validates every mapped published artifact against its schema", () => {
    const ajv = buildAjv();
    const validators = new Map<string, ReturnType<Ajv2020["compile"]>>();
    const failures: string[] = [];

    for (const { relativePath, schemaFile } of withSchema) {
      let validate = validators.get(schemaFile);
      if (!validate) {
        validate = ajv.getSchema(schemaFile) ?? ajv.compile(loadSchema(schemaFile));
        validators.set(schemaFile, validate);
      }
      const payload = JSON.parse(readFileSync(join(DATA_ROOT, relativePath), "utf8")) as unknown;
      if (!validate(payload)) {
        const first = validate.errors?.[0];
        const path = first?.instancePath && first.instancePath.length > 0 ? first.instancePath : "/";
        const message = first?.message ?? first?.keyword ?? "invalid";
        failures.push(`${relativePath} → ${schemaFile}: ${path} ${message}`);
      }
    }

    expect(
      failures,
      failures.length > 0
        ? `artefatos publicados falharam no próprio schema (corrija o artefato ou o schema; não afrouxe a validação sem ADR):\n${failures.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("counts artifacts per schema and the ones without schema for the ADR inventory", () => {
    const schemaCounts = new Map<string, number>();
    for (const { schemaFile } of withSchema) {
      schemaCounts.set(schemaFile, (schemaCounts.get(schemaFile) ?? 0) + 1);
    }
    const listCounts = new Map<string, number>();
    for (const { listEntry } of withoutSchema) {
      listCounts.set(listEntry, (listCounts.get(listEntry) ?? 0) + 1);
    }

    expect(withSchema.length).toBeGreaterThan(0);
    expect(Object.fromEntries([...schemaCounts.entries()].sort())).toMatchObject({
      "connections-puzzle-v1.json": expect.any(Number),
      "quiz-session-v2.json": expect.any(Number),
    });
    expect(Object.fromEntries([...listCounts.entries()].sort())).toMatchObject({
      "daily-set.json": expect.any(Number),
      "crossword-publication.<date>.json": expect.any(Number),
    });
  });
});
