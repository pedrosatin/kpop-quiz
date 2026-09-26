import type { PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import type { QuizDecadeSelection, QuizTheme } from "../Quiz/url-params";
import { DifficultyPicker } from "./DifficultyPicker";
import { GameCollection } from "./GameCollection";
import { TimerControl } from "./TimerControl";
import { DecadePicker } from "./DecadePicker";

export interface GameSetupProps {
  playMode: PlayMode;
  onSelectMode: (mode: PlayMode) => void;
  theme?: QuizTheme;
  onSelectTheme?: (theme: QuizTheme) => void;
  availableDecades?: Array<1990 | 2000 | 2010 | 2020>;
  decades?: QuizDecadeSelection;
  onSelectDecades?: (decades: QuizDecadeSelection) => void;
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
  availableDecades = [], decades = [], onSelectDecades,
  timerEnabled,
  onTimerChange,
  onStart,
  isReady,
  messages,
  disabled = false,
}: GameSetupProps) {
  return (
    <section id="quiz" class="game-card game-card--wide quiz-setup" aria-labelledby="difficulty-heading">
      <div class="setup-options">
        <div class="setup-heading">
          <p class="kicker">{messages.setupKicker}</p>
          <h2 id="difficulty-heading" class="game-card-title">{messages.setupTitle}</h2>
        </div>
        {/* From 60rem the two groups sit side by side: which questions on the
            left, how to play them on the right. DOM order stays the reading
            and Tab order in both layouts. */}
        <div class="setup-group">
          {onSelectTheme && (
            <GameCollection
              selectedTheme={theme}
              onSelectTheme={onSelectTheme}
              messages={messages}
              disabled={disabled}
            />
          )}
          {onSelectDecades && <DecadePicker available={availableDecades} value={decades} onChange={onSelectDecades} messages={messages} disabled={disabled} />}
        </div>
        <div class="setup-group">
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
        </div>
      </div>
      <div class="game-actions setup-actions">
        <p class="game-actions-message game-actions-hint setup-rules">{messages.roundRules}</p>
        <button
          class="btn btn-primary quiz-start"
          type="button"
          disabled={!isReady || disabled}
          onClick={onStart}
        >
          {messages.start}
        </button>
      </div>
    </section>
  );
}
