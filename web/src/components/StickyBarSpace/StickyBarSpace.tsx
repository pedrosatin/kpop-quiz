import { useEffect } from "preact/hooks";
import { installStickyBarSpace } from "../../lib/sticky-bar-space";

/**
 * Renders nothing. Mounted once per game page, it keeps the room above the
 * sticky .game-actions bar in step with the bar's real height (see
 * lib/sticky-bar-space).
 */
export function StickyBarSpace() {
  useEffect(() => installStickyBarSpace(document), []);
  return null;
}
