import type { Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import type { QuizTheme } from "../Quiz/url-params";

export interface GameCollectionProps {
  selectedTheme: QuizTheme;
  onSelectTheme: (theme: QuizTheme) => void;
  messages: Messages;
  locale?: Locale;
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
  locale,
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

  const currentLocale = locale ?? (messages.languageName === "English" ? "pt-BR" : "en");
  const gridPath = currentLocale === "pt-BR" ? "/pt-br/grid/" : "/en/grid/";
  const connectionsPath = currentLocale === "pt-BR" ? "/pt-br/conexoes/" : "/en/connections/";
  const nameGuessPath = currentLocale === "pt-BR" ? "/pt-br/adivinhe/" : "/en/guess/";
  const wordSearchPath = currentLocale === "pt-BR" ? "/pt-br/caca-palavras/" : "/en/word-search/";
  const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL)
    ? import.meta.env.BASE_URL.replace(/\/$/, "")
    : "";
  const gridHref = `${base}${gridPath}`;
  const connectionsHref = `${base}${connectionsPath}`;
  const nameGuessHref = `${base}${nameGuessPath}`;
  const wordSearchHref = `${base}${wordSearchPath}`;

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
      <div class="collection-extra-mode">
        <a href={gridHref} class="collection-grid-link">
          <strong>{messages.gridGameTitle}</strong>: {messages.gridGameDescription}
        </a>
        <a href={connectionsHref} class="collection-grid-link">
          <strong>{messages.connectionsGameTitle}</strong>: {messages.connectionsGameDescription}
        </a>
        <a href={nameGuessHref} class="collection-grid-link">
          <strong>{messages.nameGuessGameTitle}</strong>: {messages.nameGuessGameDescription}
        </a>
        <a href={wordSearchHref} class="collection-grid-link">
          <strong>{messages.wordSearchGameTitle}</strong>: {messages.wordSearchGameDescription}
        </a>
      </div>
    </fieldset>
  );
}

