export type ShareOutcome = "shared" | "copied" | "aborted" | "failed";

/** The result text with the game link on its own last line. */
export function withShareUrl(text: string, url: string): string {
  return `${text}\n${url}`;
}

/**
 * Share sheet first when the browser has one. It gets the whole text, link
 * included, and no `url` field: some targets drop `url`, and iOS "Copy" copies
 * only the URL when there is one. AbortError means the player
 * closed it, not a failure. Clipboard is next; anything else is failed.
 */
export async function shareTextToUser(text: string): Promise<ShareOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (typeof nav?.share === "function") {
    try {
      await nav.share({ text });
      return "shared";
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") {
        return "aborted";
      }
    }
  }
  try {
    if (typeof nav?.clipboard?.writeText !== "function") {
      throw new Error("no clipboard");
    }
    await nav.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
