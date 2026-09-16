import type { PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export interface DifficultyPickerProps {
  playMode: PlayMode;
  onSelectMode: (mode: PlayMode) => void;
  messages: Messages;
  disabled?: boolean;
}

const MODES: PlayMode[] = ["assisted", "standard", "expert"];

export function DifficultyPicker({
  playMode,
  onSelectMode,
  messages,
  disabled = false,
}: DifficultyPickerProps) {
  return (
    <fieldset class="difficulty-picker" disabled={disabled}>
      <legend class="visually-hidden">{messages.chooseDifficulty}</legend>
      {MODES.map((mode) => (
        <label class={`difficulty-option ${playMode === mode ? "selected" : ""}`} key={mode}>
          <input
            type="radio"
            name="play-mode"
            value={mode}
            checked={playMode === mode}
            onChange={() => onSelectMode(mode)}
          />
          <strong>{messages.difficultyName(mode)}</strong>
          <span>{messages.difficultyDescription(mode)}</span>
        </label>
      ))}
    </fieldset>
  );
}
