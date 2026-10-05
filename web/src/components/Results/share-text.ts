export type ShareOutcome = "shared" | "copied" | "aborted" | "failed";

const SHARE_TITLE = "K-pop Quiz";
const URL_LINE = /^https?:\/\/\S+$/;

/** The result text with the game link on its own last line. */
export function withShareUrl(text: string, url: string): string {
  return `${text}\n${url}`;
}

/**
 * Share sheet payload for a result text. A link on the last line goes in
 * `url`, so the target app can show a preview card without repeating the
 * link in the text. The clipboard keeps the whole text, link included.
 */
export function sharePayload(text: string): ShareData {
  const cut = text.lastIndexOf("\n");
  const lastLine = text.slice(cut + 1);
  if (cut < 0 || !URL_LINE.test(lastLine)) return { text };
  return { title: SHARE_TITLE, text: text.slice(0, cut), url: lastLine };
}

/**
 * Share sheet first when the browser has one. AbortError means the player
 * closed it, not a failure. Clipboard is next; anything else is failed.
 */
export async function shareTextToUser(text: string): Promise<ShareOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (typeof nav?.share === "function") {
    try {
      await nav.share(sharePayload(text));
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
