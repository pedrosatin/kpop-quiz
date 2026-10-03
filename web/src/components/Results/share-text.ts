export type ShareOutcome = "shared" | "copied" | "aborted" | "failed";

/**
 * Share sheet first when the browser has one. AbortError means the player
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
