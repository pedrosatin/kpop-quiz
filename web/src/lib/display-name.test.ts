import { describe, expect, it } from "vitest";
import {
  alignCaseToCanonical,
  buildLocalizedDisplayNames,
  resolveDisplayLabel,
  resolveDisplayLabels,
  stripTrailingDisambiguator,
} from "./display-name";

describe("display-name", () => {
  it("aligns SHINee casing to the canonical form", () => {
    expect(alignCaseToCanonical("shinee", "SHINee")).toBe("SHINee");
    expect(resolveDisplayLabel("shinee", "SHINee")).toBe("SHINee");
  });

  it("aligns SISTAR casing to the canonical form", () => {
    expect(resolveDisplayLabel("Sistar", "SISTAR")).toBe("SISTAR");
  });

  it("leaves Boyfriend and BF alone when the strings differ", () => {
    expect(resolveDisplayLabel("Boyfriend", "BF")).toBe("Boyfriend");
    expect(resolveDisplayLabel("BF", "BF")).toBe("BF");
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

  it("preserves internal and non-wiki parentheses", () => {
    expect(stripTrailingDisambiguator("f(x)")).toBe("f(x)");
    expect(resolveDisplayLabel("f(x)", "f(x)")).toBe("f(x)");
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
});
