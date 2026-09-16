import type { PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { DifficultyPicker } from "./DifficultyPicker";
import { GameCollection } from "./GameCollection";
import { TimerControl } from "./TimerControl";

export interface GameSetupProps {
  playMode: PlayMode;
  onSelectMode: (mode: PlayMode) => void;
  theme?: string;
  onSelectTheme?: (theme: string) => void;
  timerEnabled: boolean;
  onTimerChange: (enabled: boolean) => void;
  onStart: () => void;
  isReady: boolean;
  messages: Messages;
  disabled?: boolean;
}

export function GameSetup({
  playMode,
  onSelectMode,
  theme = "history",
  onSelectTheme,
  timerEnabled,
  onTimerChange,
  onStart,
  isReady,
  messages,
  disabled = false,
}: GameSetupProps) {
  return (
    <section id="quiz" class="quiz-card setup" aria-labelledby="difficulty-heading">
      <p class="kicker">{messages.setupKicker}</p>
      <h2 id="difficulty-heading">{messages.chooseDifficulty}</h2>
      <p class="setup-rules">{messages.roundRules}</p>
      {onSelectTheme && (
        <GameCollection
          selectedTheme={theme}
          onSelectTheme={onSelectTheme}
          messages={messages}
          disabled={disabled}
        />
      )}
      <DifficultyPicker
        playMode={playMode}
        onSelectMode={onSelectMode}
        messages={messages}
        disabled={disabled}
      />
      <TimerControl
        enabled={timerEnabled}
        onChange={onTimerChange}
        label={messages.enableTimer}
        disabled={disabled}
      />
      <button
        class="primary-action"
        type="button"
        disabled={!isReady || disabled}
        onClick={onStart}
      >
        {messages.start}
      </button>
    </section>
  );
}
