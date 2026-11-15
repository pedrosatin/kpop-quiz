import type { CodeGroupsGuess } from "../../data/code-groups";
import type { Messages } from "../../i18n/catalog";

/** The guesses sent so far, oldest first, with their exact and misplaced counts. */
export function CodeGroupsHistory({ history, label, messages }: { history: readonly CodeGroupsGuess[]; label: (id: string) => string; messages: Messages }) {
  return (
    <>
      <h2>{messages.codeHistoryHeading}</h2>
      <ol class="code-history">
        {history.map((guess, index) => (
          <li key={index}>
            <span>{guess.ids.map(label).join(" / ")}</span>
            <strong>{messages.codeGuessSummary(guess.exact, guess.misplaced)}</strong>
          </li>
        ))}
      </ol>
    </>
  );
}
