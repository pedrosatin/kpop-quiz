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
      <legend class="setup-legend">{messages.chooseDifficulty}</legend>
      {MODES.map((mode) => (
        <label class={`choice ${playMode === mode ? "selected" : ""}`} key={mode}>
          <input
            type="radio"
            name="play-mode"
            value={mode}
            checked={playMode === mode}
            onChange={() => onSelectMode(mode)}
          />
          <span class="choice-title">{messages.difficultyName(mode)}</span>
          <span class="choice-description">{messages.difficultyDescription(mode)}</span>
        </label>
      ))}
    </fieldset>
  );
}
