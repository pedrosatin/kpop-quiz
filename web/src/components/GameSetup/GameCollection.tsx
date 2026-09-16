import type { Messages } from "../../i18n/catalog";
import type { QuizTheme } from "../Quiz/url-params";

export interface GameCollectionProps {
  selectedTheme: QuizTheme;
  onSelectTheme: (theme: QuizTheme) => void;
  messages: Messages;
  disabled?: boolean;
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
}: GameCollectionProps) {
  const options: ThemeOption[] = [
    {
      id: "history",
      title: messages.generalGameTitle,
      description: messages.generalGameDescription,
    },
    {
      id: "daily",
      title: messages.dailyGameTitle,
      description: messages.dailyGameDescription,
    },
  ];

  return (
    <fieldset class="game-collection" disabled={disabled}>
      <legend class="visually-hidden">{messages.collectionTitle}</legend>
      <div class="collection-options" role="radiogroup" aria-label={messages.collectionTitle}>
        {options.map((option) => (
          <label
            class={`collection-option ${selectedTheme === option.id ? "selected" : ""}`}
            key={option.id}
          >
            <input
              type="radio"
              name="quiz-theme"
              value={option.id}
              checked={selectedTheme === option.id}
              onChange={() => onSelectTheme(option.id)}
            />
            <strong>{option.title}</strong>
            <span>{option.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
