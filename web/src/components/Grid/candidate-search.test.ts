import { describe, expect, it } from "vitest";
import type { CandidateEntity } from "../../lib/quiz-types";
import { buildCandidateIndex, namedMatchIndex, normalizeSearch, searchCandidates } from "./candidate-search";

function group(id: string, name: string, aliases?: string[], pt = name): CandidateEntity {
  return { id, canonical_name: name, names: { "pt-BR": pt, en: name }, ...(aliases ? { aliases } : {}) };
}

// Spellings and aliases as published in the catalog (Wikidata labels and
// alternative labels of each group's entity snapshot).
const pool: CandidateEntity[] = [
  group("Q27989963", "KARD", ["K ♠ RD", "카드"], "K.A.R.D"),
  group("Q51885404", "I-dle", ["(G)I-DLE", "(여자)아이들", "아이들"]),
  group("Q55624444", "NCT 127", ["NCT127"]),
  group("Q111381707", "Le Sserafim", ["LE SSERAFIM", "르세라핌"]),
  group("Q113189277", "NewJeans", ["NJZ", "뉴진스"]),
  group("Q23772001", "Got7", ["갓세븐"]),
  group("Q25056945", "Blackpink", ["Black Pink", "블랙핑크"]),
  group("Q495383", "T-ara", ["Tiara", "티아라"]),
  group("Q344286", "f(x)", ["FX", "에프엑스"]),
  group("Q20153", "Girls' Generation", ["SNSD", "소녀시대", "소시"]),
  group("Q192983", "TVXQ", ["DBSK", "동방신기"]),
  group("Q13580495", "BTS", ["Bangtan Sonyeondan", "방탄소년단"]),
  group("Q39070585", "Stray Kids"),
  group("Q55076870", "IVE"),
];

const index = buildCandidateIndex(pool, "pt-BR", new Map());
const names = (query: string) => searchCandidates(index, query).map((m) => m.candidate.canonical_name);

describe("normalizeSearch", () => {
  it("drops accents, case, punctuation and spaces", () => {
    expect(normalizeSearch("ìvé")).toBe("ive");
    expect(normalizeSearch("K.A.R.D")).toBe("kard");
    expect(normalizeSearch("(G)I-DLE")).toBe("gidle");
    expect(normalizeSearch("  Stray-Kids ")).toBe("straykids");
    expect(normalizeSearch("Girls' Generation")).toBe("girlsgeneration");
    expect(normalizeSearch("f(x)")).toBe("fx");
  });

  it("folds full-width letters and keeps Hangul", () => {
    expect(normalizeSearch("ＢＴＳ")).toBe("bts");
    expect(normalizeSearch("방탄소년단")).toBe(normalizeSearch("방탄 소년단"));
    expect(normalizeSearch("방탄소년단")).not.toBe("");
  });

  it("reads a search of only punctuation as empty", () => {
    expect(normalizeSearch(" .-() ")).toBe("");
  });
});

describe("searchCandidates", () => {
  // Searches from the 2026-11-11 playtest that found nothing.
  it.each([
    ["kard", "KARD"],
    ["k.a.r.d", "KARD"],
    ["idle", "I-dle"],
    ["i-dle", "I-dle"],
    ["gidle", "I-dle"],
    ["(g)i-dle", "I-dle"],
    ["nct127", "NCT 127"],
    ["lesserafim", "Le Sserafim"],
    ["new jeans", "NewJeans"],
    ["got 7", "Got7"],
    ["black pink", "Blackpink"],
    ["tara", "T-ara"],
    ["fx", "f(x)"],
    ["snsd", "Girls' Generation"],
    ["dbsk", "TVXQ"],
    ["소녀시대", "Girls' Generation"],
    ["방탄", "BTS"],
    ["Stray-Kids", "Stray Kids"],
    ["straykids", "Stray Kids"],
    ["stray  kids", "Stray Kids"],
  ])("%s finds %s first", (query, expected) => {
    expect(names(query)[0]).toBe(expected);
  });

  it("finds every group on an empty search, in pool order, with no alias", () => {
    const matches = searchCandidates(index, "  ");
    expect(matches.map((m) => m.candidate)).toEqual(pool);
    expect(matches.every((m) => m.alias === null)).toBe(true);
  });

  it("names the alias that matched only when no shown name matched as well", () => {
    const snsd = searchCandidates(index, "snsd")[0]!;
    expect(snsd.alias).toBe("SNSD");
    // "LE SSERAFIM" reads the same as the shown name, so nothing extra shows.
    expect(searchCandidates(index, "LE SSERAFIM")[0]!.alias).toBeNull();
    // "K.A.R.D" (pt-BR label) and "KARD" (canonical) read the same.
    expect(searchCandidates(index, "k.a.r.d")[0]!.alias).toBeNull();
    // The label of the other language is searchable as an alias.
    const labels = buildCandidateIndex([group("Q1", "Seventeen", undefined, "Dezessete")], "en", new Map());
    expect(searchCandidates(labels, "dezessete")[0]!.alias).toBe("Dezessete");
  });

  it("puts whole names first, then names that start with the search", () => {
    const local: CandidateEntity[] = [group("Q1", "Olive"), group("Q2", "IVE"), group("Q3", "Ivery")];
    const order = searchCandidates(buildCandidateIndex(local, "en", new Map()), "ive").map((m) => m.candidate.id);
    expect(order).toEqual(["Q2", "Q3", "Q1"]);
  });

  it("reads grids published without aliases", () => {
    const legacy = buildCandidateIndex([group("Q1", "Girls' Generation")], "en", new Map());
    expect(searchCandidates(legacy, "girls generation")).toHaveLength(1);
    expect(searchCandidates(legacy, "snsd")).toHaveLength(0);
  });
});

describe("namedMatchIndex", () => {
  const named = (query: string, local = index) => {
    const matches = searchCandidates(local, query);
    const i = namedMatchIndex(matches, query);
    return i < 0 ? null : matches[i]!.candidate.canonical_name;
  };

  it("names the same group however the fan spaces or punctuates it", () => {
    const local = buildCandidateIndex([group("Q1", "Stray Kids"), group("Q2", "Stray Kids Unit")], "en", new Map());
    expect(named("stray kids", local)).toBe("Stray Kids");
    expect(named("straykids", local)).toBe("Stray Kids");
    expect(named("Stray-Kids", local)).toBe("Stray Kids");
    expect(named("stray", local)).toBeNull();
  });

  it("names a group by an alias only one group has", () => {
    const local = buildCandidateIndex(
      [group("Q1", "Girls' Generation", ["SNSD"]), group("Q2", "Girls' Generation-TTS", ["SNSD-TTS"])],
      "en",
      new Map(),
    );
    expect(named("snsd", local)).toBe("Girls' Generation");
    const shared = buildCandidateIndex([group("Q1", "Alpha", ["AB"]), group("Q2", "Beta", ["AB"])], "en", new Map());
    expect(named("ab", shared)).toBeNull();
  });

  it("names nothing by a piece of an alias, even as the only match", () => {
    // Blackpink's Wikidata aliases include "South Korean singer".
    const local = buildCandidateIndex(
      [group("Q25056945", "Blackpink", ["South Korean singer", "Black Pink"]), group("Q1", "TWICE")],
      "en",
      new Map(),
    );
    for (const query of ["singer", "south", "korean"]) {
      const matches = searchCandidates(local, query);
      expect(matches.map((m) => m.candidate.id)).toEqual(["Q25056945"]);
      expect(namedMatchIndex(matches, query)).toBe(-1);
    }
    // A whole alias only one group has still names it.
    expect(named("south korean singer", local)).toBe("Blackpink");
    expect(named("snsd")).toBe("Girls' Generation");
    // The start of a shown name, as the only match, still names it (#365).
    expect(named("blackp", local)).toBe("Blackpink");
  });

  it("names nothing on an empty search", () => {
    expect(namedMatchIndex(searchCandidates(index, ""), "")).toBe(-1);
  });
});
