import { describe, expect, it } from "vitest";
import overrideTable from "../data/display-label-overrides.json" with { type: "json" };
import {
  alignLoneLabel,
  applyDisplayOverride,
  buildLocalizedDisplayNames,
  resolveDisplayLabels,
  stripTrailingDisambiguator,
} from "./display-name";

function resolveOne(label: string | null, canonical: string): string {
  return resolveDisplayLabels([{ label, canonical }])[0]!;
}

// Labels that differ from canonical_name only by case in the published
// artifacts. Each one is a source spelling and stays as published unless a
// reviewed override cites evidence.
const CASE_ONLY_PUBLISHED: ReadonlyArray<readonly [label: string, canonical: string]> = [
  ["Ateez", "ATEEZ"],
  ["Mamamoo", "MAMAMOO"],
  ["Ive", "IVE"],
  ["tripleS", "TripleS"],
  ["izna", "Izna"],
  ["Sistar", "SISTAR"],
  ["Luv", "LUV"],
  ["Imfact", "IMFACT"],
  ["A Train To Autumn", "A Train to Autumn"],
];

describe("display-name", () => {
  it("keeps every case-only difference as published", () => {
    for (const [label, canonical] of CASE_ONLY_PUBLISHED) {
      expect(resolveOne(label, canonical), `${label} vs ${canonical}`).toBe(label);
      expect(alignLoneLabel(label, canonical), `${label} vs ${canonical}`).toBe(label);
    }
  });

  it("does not treat the canonical name as the better spelling", () => {
    // The published label wins in both directions.
    expect(resolveOne("ATEEZ", "Ateez")).toBe("ATEEZ");
    expect(resolveOne("Ateez", "ATEEZ")).toBe("Ateez");
  });

  it("applies the reviewed SHINee spelling only to the published pt-BR label", () => {
    expect(applyDisplayOverride("shinee", "Q269836", "pt-BR")).toBe("SHINee");
    // Another locale, another entity, or a label already fixed upstream: untouched.
    expect(applyDisplayOverride("shinee", "Q269836", "en")).toBe("shinee");
    expect(applyDisplayOverride("shinee", "Q1", "pt-BR")).toBe("shinee");
    expect(applyDisplayOverride("Shinee", "Q269836", "pt-BR")).toBe("Shinee");
    expect(applyDisplayOverride("shinee", undefined, "pt-BR")).toBe("shinee");
    expect(applyDisplayOverride("shinee", "Q269836", undefined)).toBe("shinee");
    expect(
      resolveDisplayLabels([{ label: "shinee", canonical: "SHINee", id: "Q269836" }], "pt-BR"),
    ).toEqual(["SHINee"]);
    expect(alignLoneLabel("shinee", "SHINee", "Q269836", "pt-BR")).toBe("SHINee");
    expect(alignLoneLabel("shinee", "SHINee")).toBe("shinee");
  });

  it("only ships overrides that cite pinned source revisions", () => {
    const table = overrideTable as {
      overrides: Array<{
        qid: string;
        published: string;
        display: string;
        evidence: Array<{ locator: string; source_url: string }>;
      }>;
    };
    expect(table.overrides.length).toBeGreaterThan(0);
    for (const entry of table.overrides) {
      expect(entry.qid).toMatch(/^Q[1-9][0-9]*$/);
      expect(entry.display).not.toBe(entry.published);
      expect(entry.evidence.length).toBeGreaterThan(0);
      for (const item of entry.evidence) {
        expect(item.locator).toMatch(/revid=\d+/);
        expect(item.source_url).toMatch(/^https:\/\//);
      }
    }
  });

  it("leaves Boyfriend and BF alone when the strings differ", () => {
    expect(resolveOne("Boyfriend", "BF")).toBe("Boyfriend");
    expect(resolveOne("BF", "BF")).toBe("BF");
  });

  it("strips unique Wikipedia disambiguators among peers", () => {
    expect(
      resolveDisplayLabels([
        { label: "Tempest (grupo)", canonical: "Tempest" },
        { label: "Uniq (banda)", canonical: "Uniq" },
        { label: "Luv (grupo sul-coreano)", canonical: "LUV" },
      ]),
    ).toEqual(["Tempest", "Uniq", "Luv"]);
  });

  it("keeps disambiguators when stripping would create a homonym", () => {
    expect(
      resolveDisplayLabels([
        { label: "Tempest (grupo)", canonical: "Tempest" },
        { label: "Tempest (banda)", canonical: "Tempest (banda)" },
      ]),
    ).toEqual(["Tempest (grupo)", "Tempest (banda)"]);
  });

  it("keeps the note when homonyms share the canonical name", () => {
    expect(
      resolveDisplayLabels([
        { label: "Tempest (grupo)", canonical: "Tempest" },
        { label: "Tempest (banda)", canonical: "Tempest" },
      ]),
    ).toEqual(["Tempest (grupo)", "Tempest (banda)"]);
  });

  it("keeps the note against a peer that already has the bare name", () => {
    expect(
      resolveDisplayLabels([
        { label: "Tempest (grupo)", canonical: "Tempest" },
        { label: "Tempest", canonical: "Tempest" },
      ]),
    ).toEqual(["Tempest (grupo)", "Tempest"]);
  });

  it("compares peers ignoring case", () => {
    expect(
      resolveDisplayLabels([
        { label: "Luv (grupo)", canonical: "LUV" },
        { label: "LUV (banda)", canonical: "LUV" },
      ]),
    ).toEqual(["Luv (grupo)", "LUV (banda)"]);
  });

  it("does not let unrelated peers block a strip", () => {
    expect(
      resolveDisplayLabels([
        { label: "Tempest (grupo)", canonical: "Tempest" },
        { label: "Everglow", canonical: "Everglow" },
        { label: "Tempest Two", canonical: "Tempest Two" },
      ]),
    ).toEqual(["Tempest", "Everglow", "Tempest Two"]);
  });

  it("never strips a label shown without its peers", () => {
    expect(alignLoneLabel("Tempest (grupo)", "Tempest")).toBe("Tempest (grupo)");
    expect(alignLoneLabel("", "TWICE")).toBe("TWICE");
    expect(alignLoneLabel(null, "TWICE")).toBe("TWICE");
  });

  it("preserves internal and non-wiki parentheses", () => {
    expect(stripTrailingDisambiguator("f(x)")).toBe("f(x)");
    expect(resolveOne("f(x)", "f(x)")).toBe("f(x)");
    expect(stripTrailingDisambiguator("SHINee (pt)")).toBe("SHINee (pt)");
    expect(stripTrailingDisambiguator("April (girl group)")).toBe("April");
    expect(stripTrailingDisambiguator("Aimers (band)")).toBe("Aimers");
    expect(stripTrailingDisambiguator("IZ (grupo musical)")).toBe("IZ");
    expect(stripTrailingDisambiguator("B.O.Y (Grupo musical)")).toBe("B.O.Y");
  });

  it("builds localized maps for grid/connections pools", () => {
    const map = buildLocalizedDisplayNames(
      [
        {
          id: "Q269836",
          canonical_name: "SHINee",
          names: { "pt-BR": "shinee", en: "SHINee" },
        },
        {
          id: "Q110920753",
          canonical_name: "Tempest",
          labels: { "pt-BR": "Tempest (grupo)", en: "Tempest" },
        },
      ],
      "pt-BR",
    );
    expect(map.get("Q269836")).toBe("SHINee");
    expect(map.get("Q110920753")).toBe("Tempest");
    expect(buildLocalizedDisplayNames([{ id: "Q269836", canonical_name: "SHINee", names: { "pt-BR": "shinee", en: "SHINee" } }], "en").get("Q269836")).toBe("SHINee");
  });

  it("resolves a pool against all its members", () => {
    const map = buildLocalizedDisplayNames(
      [
        { id: "Q1", canonical_name: "Tempest", labels: { "pt-BR": "Tempest (grupo)" } },
        { id: "Q2", canonical_name: "Tempest", labels: { "pt-BR": "Tempest (banda)" } },
        { id: "Q3", canonical_name: "Uniq", labels: { "pt-BR": "Uniq (banda)" } },
      ],
      "pt-BR",
    );
    expect([map.get("Q1"), map.get("Q2"), map.get("Q3")]).toEqual([
      "Tempest (grupo)",
      "Tempest (banda)",
      "Uniq",
    ]);
  });
});
