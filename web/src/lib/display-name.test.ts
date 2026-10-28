import { describe, expect, it } from "vitest";
import {
  alignCaseToCanonical,
  alignLoneLabel,
  buildLocalizedDisplayNames,
  resolveDisplayLabels,
  stripTrailingDisambiguator,
} from "./display-name";

function resolveOne(label: string | null, canonical: string): string {
  return resolveDisplayLabels([{ label, canonical }])[0]!;
}

describe("display-name", () => {
  it("aligns SHINee casing to the canonical form", () => {
    expect(alignCaseToCanonical("shinee", "SHINee")).toBe("SHINee");
    expect(resolveOne("shinee", "SHINee")).toBe("SHINee");
  });

  it("aligns SISTAR casing to the canonical form", () => {
    expect(resolveOne("Sistar", "SISTAR")).toBe("SISTAR");
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
    ).toEqual(["Tempest", "Uniq", "LUV"]);
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
    expect(alignLoneLabel("shinee", "SHINee")).toBe("SHINee");
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
