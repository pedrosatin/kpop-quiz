import type { PlayMode } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { DEFAULT_QUIZ_THEME, type QuizDecadeSelection, type QuizTheme } from "../Quiz/url-params";
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
  /** Marks the setup aria-busy while the session loads; isReady controls Start. */
  busy?: boolean;
  /** Announced through a visually hidden status while busy. */
  busyLabel?: string;
  /** Visible notice above Start (e.g. today's challenge already counted). */
  notice?: string | undefined;
}

export function GameSetup({
  playMode,
  onSelectMode,
  theme = DEFAULT_QUIZ_THEME,
  onSelectTheme,
  availableDecades = [], decades = [], onSelectDecades,
  timerEnabled,
  onTimerChange,
  onStart,
  isReady,
  messages,
  disabled = false,
  busy = false,
  busyLabel,
  notice,
}: GameSetupProps) {
  const hasDecades = Boolean(onSelectDecades && availableDecades.length);
  return (
    <section id="quiz" class="game-card game-card--wide quiz-setup" data-testid="game-setup" aria-labelledby="difficulty-heading" aria-busy={busy}>
      <div class="setup-options">
        <div class="setup-heading">
          <p class="kicker">{messages.setupKicker}</p>
          <h2 id="difficulty-heading" class="game-card-title">{messages.setupTitle}</h2>
        </div>
        {onSelectTheme && (
          <GameCollection
            selectedTheme={theme}
            onSelectTheme={onSelectTheme}
            messages={messages}
            disabled={disabled}
          />
        )}
        {/* The kind of quiz is the one choice a visit needs; Start already
            plays today's challenge. The mode, the timer and the decades stay
            one tap away, and the summary line says what they are set to.
            From 60rem the open group runs in two columns: the decades on the
            left, the mode and the timer on the right. DOM order stays the
            reading and Tab order in both layouts. */}
        <details class="setup-customize">
          <summary class="setup-customize-toggle">
            <span class="setup-customize-title">{messages.customize}</span>
            <span class="setup-customize-summary" data-testid="setup-customize-summary">
              {messages.customizeSummary(messages.difficultyName(playMode), timerEnabled, hasDecades ? decades : [])}
            </span>
          </summary>
          <div class={`setup-customize-body${hasDecades ? " setup-customize-body--split" : ""}`}>
            {hasDecades && onSelectDecades && (
              <div class="setup-group">
                <DecadePicker available={availableDecades} value={decades} onChange={onSelectDecades} messages={messages} disabled={disabled} />
              </div>
            )}
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
        </details>
      </div>
      {busy && busyLabel && <p class="visually-hidden" role="status">{busyLabel}</p>}
      {notice && <p class="game-actions-message" role="status" data-testid="quiz-replay-notice">{notice}</p>}
      <div class="game-actions setup-actions">
        <p class="game-actions-message game-actions-hint setup-rules">{messages.roundRules}</p>
        <button
          class="btn btn-primary quiz-start"
          type="button"
          data-testid="game-start"
          disabled={!isReady || disabled}
          onClick={onStart}
        >
          {messages.start}
        </button>
      </div>
    </section>
  );
}
