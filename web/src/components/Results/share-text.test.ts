import { afterEach, describe, expect, it, vi } from "vitest";
import { sharePayload, shareTextToUser, withShareUrl } from "./share-text";

describe("shareTextToUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await expect(shareTextToUser("hello")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "hello" });
  });

  it("treats AbortError as aborted, not failed", async () => {
    const err = new Error("closed");
    err.name = "AbortError";
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(err),
      clipboard: { writeText: vi.fn() },
    });
    await expect(shareTextToUser("hello")).resolves.toBe("aborted");
  });

  it("falls back to the clipboard when share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(shareTextToUser("hello")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to the clipboard when share rejects without AbortError", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new Error("nope")),
      clipboard: { writeText },
    });
    await expect(shareTextToUser("hello")).resolves.toBe("copied");
  });

  it("returns failed when neither share nor clipboard works", async () => {
    vi.stubGlobal("navigator", {});
    await expect(shareTextToUser("hello")).resolves.toBe("failed");
  });

  it("passes a trailing link as the share sheet url and copies the whole text", async () => {
    const url = "https://kpopquiz.online/en/grid/?utm_source=share";
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await shareTextToUser(withShareUrl("K-pop Grid\n🟩", url));
    expect(share).toHaveBeenCalledWith({ title: "K-pop Quiz", text: "K-pop Grid\n🟩", url });

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await shareTextToUser(withShareUrl("K-pop Grid\n🟩", url));
    expect(writeText).toHaveBeenCalledWith(`K-pop Grid\n🟩\n${url}`);
  });
});

describe("sharePayload", () => {
  it("keeps text without a trailing link as is", () => {
    expect(sharePayload("hello")).toEqual({ text: "hello" });
    expect(sharePayload("hello\nworld")).toEqual({ text: "hello\nworld" });
    expect(sharePayload("https://kpopquiz.online/")).toEqual({ text: "https://kpopquiz.online/" });
  });
});
