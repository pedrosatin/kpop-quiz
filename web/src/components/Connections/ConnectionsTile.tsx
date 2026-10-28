import { alignLoneLabel } from "../../lib/display-name";
import type { ConnectionsTileProps } from "./types";

/**
 * Splits a name after ":", "-", "." or "/" ("DAILY:" + "DIRECTION"). The
 * tile marks those places as break points that stay off until the name
 * does not fit at the smallest font (see fitTileText).
 */
export function tileNameParts(name: string): string[] {
  // No lookbehind: Safari before 16.4 fails to parse it and drops the chunk.
  return name.replace(/([:\-./])(?=\S)/g, "$1\n").split("\n");
}

export function ConnectionsTile({
  item,
  isSelected,
  disabled = false,
  onToggle,
  locale,
  messages,
  displayName: displayNameProp,
}: ConnectionsTileProps) {
  // The board resolves every tile against its peers; alone, a tile keeps the
  // published label (plus any reviewed override), so a suffix that keeps two
  // names apart is never dropped.
  const displayName =
    displayNameProp || alignLoneLabel(item.labels[locale], item.canonical_name, item.id, locale);
  const ariaLabel = messages.connectionsItemAriaLabel(displayName, isSelected);

  return (
    <button
      type="button"
      class={`connections-tile ${isSelected ? "selected" : ""}`}
      aria-pressed={isSelected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onToggle(item.id)}
    >
      <span class="connections-tile-text">
        {tileNameParts(displayName).map((part, index) => (
          <span key={index}>
            {index > 0 && <span class="connections-tile-break">{"\u200B"}</span>}
            {part}
          </span>
        ))}
      </span>
    </button>
  );
}
