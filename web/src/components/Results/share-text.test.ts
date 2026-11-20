import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canUseClipboardWrite,
  canUseNativeShare,
  shareTextToUser,
  withShareUrl,
} from "./share-text";

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
    const writeText = vi.fn();
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(err),
      clipboard: { writeText },
    });
    await expect(shareTextToUser("hello")).resolves.toBe("aborted");
    expect(writeText).not.toHaveBeenCalled();
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

  it("sends the whole text, link included and without a url field, to the share sheet and the clipboard", async () => {
    const url = "https://kpopquiz.online/en/grid/?utm_source=share";
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await shareTextToUser(withShareUrl("K-pop Grid\n🟩", url));
    expect(share).toHaveBeenCalledWith({ text: `K-pop Grid\n🟩\n${url}` });

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await shareTextToUser(withShareUrl("K-pop Grid\n🟩", url));
    expect(writeText).toHaveBeenCalledWith(`K-pop Grid\n🟩\n${url}`);
  });

  it("prefers injected deps over navigator", async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    const navWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: navShare, clipboard: { writeText: navWrite } });

    const share = vi.fn().mockResolvedValue(undefined);
    await expect(shareTextToUser("via-deps", { share })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "via-deps" });
    expect(navShare).not.toHaveBeenCalled();

    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareTextToUser("copied-deps", { writeText })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("copied-deps");
    expect(navWrite).not.toHaveBeenCalled();
  });

  it("maps injected share AbortError and non-abort to the same outcomes", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    await expect(
      shareTextToUser("x", { share: vi.fn().mockRejectedValue(abort), writeText: vi.fn() }),
    ).resolves.toBe("aborted");

    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(
      shareTextToUser("x", {
        share: vi.fn().mockRejectedValue(new Error("boom")),
        writeText,
      }),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("x");
  });

  it("returns failed when injected writeText rejects", async () => {
    await expect(
      shareTextToUser("x", {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      }),
    ).resolves.toBe("failed");
  });
});

describe("share capability helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports native share and clipboard from navigator", () => {
    vi.stubGlobal("navigator", {});
    expect(canUseNativeShare()).toBe(false);
    expect(canUseClipboardWrite()).toBe(false);

    vi.stubGlobal("navigator", { share: vi.fn(), clipboard: { writeText: vi.fn() } });
    expect(canUseNativeShare()).toBe(true);
    expect(canUseClipboardWrite()).toBe(true);
  });
});
