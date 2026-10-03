import type { Messages } from "../../i18n/catalog";

export interface ConnectionsControlsProps {
  selectedCount: number;
  onShuffle: () => void;
  onClear: () => void;
  onSubmit: () => void;
  messages: Messages;
}

export function ConnectionsControls({
  selectedCount,
  onShuffle,
  onClear,
  onSubmit,
  messages,
}: ConnectionsControlsProps) {
  return (
    <div class="connections-controls">
      <button type="button" class="btn btn-secondary" onClick={onShuffle}>
        {messages.connectionsShuffle}
      </button>
      <button
        type="button"
        class="btn btn-secondary"
        disabled={selectedCount === 0}
        onClick={onClear}
      >
        {messages.connectionsDeselectAll}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={selectedCount !== 4}
        onKeyDown={(event) => {
          if (event.repeat) event.preventDefault();
        }}
        onClick={onSubmit}
      >
        {messages.connectionsSubmit}
      </button>
    </div>
  );
}
