import type { ConnectionsTileProps } from "./types";

export function ConnectionsTile({
  item,
  isSelected,
  disabled = false,
  onToggle,
  locale,
  messages,
}: ConnectionsTileProps) {
  const displayName = item.labels[locale] || item.canonical_name;
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
      <span class="connections-tile-text">{displayName}</span>
    </button>
  );
}
