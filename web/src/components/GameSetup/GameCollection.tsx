import type { Messages } from "../../i18n/catalog";
import type { QuizTheme } from "../Quiz/url-params";

export interface GameCollectionProps {
  selectedTheme: QuizTheme;
  onSelectTheme: (theme: QuizTheme) => void;
  messages: Messages;
  disabled?: boolean;
  /** Replaces the general quiz's description, e.g. where its saved round stopped. */
  generalNote?: string;
}

interface ThemeOption {
  id: QuizTheme;
  title: string;
  description: string;
}

export function GameCollection({
  selectedTheme,
  onSelectTheme,
  messages,
  disabled = false,
  generalNote,
}: GameCollectionProps) {
  // Today's challenge is the default and comes first, so on a phone the
  // selected card is the one above the sticky Start bar.
  const options: ThemeOption[] = [
    {
      id: "daily",
      title: messages.dailyGameTitle,
      description: messages.dailyGameDescription,
    },
    {
      id: "history",
      title: messages.generalGameTitle,
      description: generalNote ?? messages.generalGameDescription,
    },
  ];

  return (
    <fieldset class="game-collection" disabled={disabled}>
      <legend class="visually-hidden">{messages.collectionTitle}</legend>
      <div class="collection-options" role="radiogroup" aria-label={messages.collectionTitle}>
        {options.map((option) => (
          <label
            class={`choice ${selectedTheme === option.id ? "selected" : ""}`}
            key={option.id}
          >
            <input
              type="radio"
              name="quiz-theme"
              value={option.id}
              checked={selectedTheme === option.id}
              onChange={() => onSelectTheme(option.id)}
            />
            <span class="choice-title">{option.title}</span>
            <span class="choice-description">{option.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

