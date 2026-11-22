export type ShareOutcome = "shared" | "copied" | "aborted" | "failed";

/** Optional fakes for unit tests. Production omits this argument. */
export interface ShareTextDeps {
  share?: (data: { text: string }) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

/** The result text with the game link on its own last line. */
export function withShareUrl(text: string, url: string): string {
  return `${text}\n${url}`;
}

/** True when the browser exposes a native share sheet. */
export function canUseNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** True when the browser can write to the clipboard via `writeText`. */
export function canUseClipboardWrite(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function"
  );
}

/**
 * Share sheet first when the browser has one. It gets the whole text, link
 * included, and no `url` field: some targets drop `url`, and iOS "Copy" copies
 * only the URL when there is one. AbortError means the player
 * closed it, not a failure. Clipboard is next; anything else is failed.
 */
export async function shareTextToUser(
  text: string,
  deps?: ShareTextDeps,
): Promise<ShareOutcome> {
  const share = deps
    ? deps.share
    : canUseNativeShare()
      ? (data: { text: string }) => navigator.share(data)
      : undefined;

  if (typeof share === "function") {
    try {
      await share({ text });
      return "shared";
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") {
        return "aborted";
      }
    }
  }

  const writeText = deps
    ? deps.writeText
    : canUseClipboardWrite()
      ? (value: string) => navigator.clipboard.writeText(value)
      : undefined;

  try {
    if (typeof writeText !== "function") {
      throw new Error("no clipboard");
    }
    await writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
