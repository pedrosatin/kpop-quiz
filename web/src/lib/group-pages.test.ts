import { describe, expect, it } from "vitest";
import {
  GROUP_PAGES,
  RESERVED_GROUP_SLUGS,
  groupDataBasePath,
  groupPageBySlug,
  groupPageKey,
  groupPagePath,
  isGroupPageKey,
} from "./group-pages";

describe("group page allowlist", () => {
  it("publishes only Stray Kids in this pilot", () => {
    expect(GROUP_PAGES.map((page) => page.slug)).toEqual(["stray-kids"]);
    expect(GROUP_PAGES[0]?.wikidataId).toBe("Q46134670");
    expect(GROUP_PAGES[0]?.currentMemberIds).toHaveLength(8);
    expect(GROUP_PAGES[0]?.formerMemberIds).toEqual(["Q61100680"]);
  });

  it("rejects reserved game and privacy slugs", () => {
    expect(RESERVED_GROUP_SLUGS.has("grid")).toBe(true);
    expect(RESERVED_GROUP_SLUGS.has("privacidade")).toBe(true);
    expect(RESERVED_GROUP_SLUGS.has("stray-kids")).toBe(false);
  });

  it("builds locale paths and data keys", () => {
    expect(groupPagePath("stray-kids", "pt-BR")).toBe("/pt-br/stray-kids/");
    expect(groupPagePath("stray-kids", "en")).toBe("/en/stray-kids/");
    expect(groupPageKey("stray-kids")).toBe("group:stray-kids");
    expect(isGroupPageKey("group:stray-kids")).toBe(true);
    expect(isGroupPageKey("quiz")).toBe(false);
    expect(groupDataBasePath("stray-kids")).toBe("group-pages/stray-kids");
    expect(groupPageBySlug("bts")).toBeUndefined();
    expect(groupPageBySlug("stray-kids")?.name).toBe("Stray Kids");
  });
});
