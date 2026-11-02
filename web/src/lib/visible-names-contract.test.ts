import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aloneLabel, hiddenNote, visibleLabels, type PublishedName } from "../../e2e/helpers/visible-names";
import { alignLoneLabel, buildLocalizedDisplayNames, stripTrailingDisambiguator } from "./display-name";

/**
 * The e2e specs judge the page against `e2e/helpers/visible-names`, written
 * apart from `display-name` on purpose. This suite runs both over the labels
 * the site really publishes, so a helper that is looser or stricter than the
 * product fails here instead of passing or failing the browser specs by luck.
 */

const DATA_DIR = join(import.meta.dirname, "../../public/data");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return path.endsWith(".json") ? [path] : [];
  });
}

function collectLabels(value: unknown, into: Set<string>, key = ""): void {
  if (typeof value === "string") {
    if (key === "canonical_name" || key === "pt-BR" || key === "en") into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLabels(item, into, key);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectLabels(v, into, k);
  }
}

function publishedLabels(): string[] {
  const labels = new Set<string>();
  for (const file of jsonFiles(DATA_DIR)) collectLabels(JSON.parse(readFileSync(file, "utf8")), labels);
  return [...labels];
}

const EDGE_CASES = [
  "Tempest (grupo)",
  "Uniq (banda)",
  "Luv (grupo sul-coreano)",
  "Redsquare (South Korean band)",
  "ITZY (girl group)",
  "Cravity (group)",
  "Cravity (Grupo musical)",
  "Duo Name (duo)",
  "Lemonade (álbum de Aespa)",
  "Name (South Korean girl group)",
  "f(x)",
  "+(Kr)ystal Eyes",
  "Plain",
];

function productStrips(label: string): boolean {
  return stripTrailingDisambiguator(label) !== label.trim();
}

describe("e2e visible-names helper agrees with the product", () => {
  it("hides the same trailing notes on the edge cases", () => {
    for (const label of EDGE_CASES) {
      expect(hiddenNote(label) !== null, label).toBe(productStrips(label));
    }
  });

  it("keeps notes that are not Wikipedia disambiguators", () => {
    for (const label of ["Duo Name (duo)", "Lemonade (álbum de Aespa)", "f(x)", "+(Kr)ystal Eyes"]) {
      expect(hiddenNote(label), label).toBeNull();
      expect(productStrips(label), label).toBe(false);
    }
  });

  it("hides the same trailing notes on every published label", () => {
    const labels = publishedLabels();
    expect(labels.length).toBeGreaterThan(50);
    const noted = labels.filter((label) => /\)$/.test(label));
    expect(noted.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(hiddenNote(label) !== null, label).toBe(productStrips(label));
    }
  });

  it("shows the same set of names, homonym guard included", () => {
    const items: PublishedName[] = [
      { id: "Q1", canonical_name: "Tempest", labels: { "pt-BR": "Tempest (grupo)", en: "Tempest (group)" } },
      { id: "Q2", canonical_name: "Uniq", labels: { "pt-BR": "Uniq (banda)", en: "Uniq" } },
      { id: "Q3", canonical_name: "Uniq", labels: { "pt-BR": "Uniq (grupo)", en: "Uniq (group)" } },
      { id: "Q4", canonical_name: "Duo", labels: { "pt-BR": "Duo (duo)", en: "Duo (duo)" } },
      { id: "Q269836", canonical_name: "SHINee", labels: { "pt-BR": "shinee", en: "SHINee" } },
      { id: "Q5", canonical_name: "ATEEZ", labels: { "pt-BR": "Ateez", en: "ATEEZ" } },
    ];
    for (const locale of ["pt-BR", "en"] as const) {
      const product = buildLocalizedDisplayNames(items, locale);
      const helper = visibleLabels(items, locale);
      expect([...helper.entries()], locale).toEqual([...product.entries()]);
    }
  });

  it("shows the same names on the published connections boards", () => {
    for (const file of ["connections.daily.json", "next/connections.daily.json"]) {
      const board = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as { items: PublishedName[] };
      for (const locale of ["pt-BR", "en"] as const) {
        const product = buildLocalizedDisplayNames(board.items, locale);
        expect([...visibleLabels(board.items, locale).entries()], `${file} ${locale}`).toEqual([...product.entries()]);
      }
    }
  });

  it("shows a lone label the same way, notes kept and reviewed spelling applied", () => {
    const items: PublishedName[] = [
      { id: "Q1", canonical_name: "Tahiti", labels: { "pt-BR": "Tahiti (banda)", en: "Tahiti" } },
      { id: "Q269836", canonical_name: "SHINee", labels: { "pt-BR": "shinee", en: "SHINee" } },
      { id: "Q5", canonical_name: "ATEEZ", labels: { "pt-BR": "Ateez", en: "ATEEZ" } },
      { id: "Q6", canonical_name: "TWICE", labels: { "pt-BR": "", en: "" } },
    ];
    for (const item of items) {
      for (const locale of ["pt-BR", "en"] as const) {
        expect(aloneLabel(item, locale), `${item.id} ${locale}`).toBe(
          alignLoneLabel(item.labels[locale], item.canonical_name, item.id, locale),
        );
      }
    }
  });
});
