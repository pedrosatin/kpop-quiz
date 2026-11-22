import { useId } from "preact/hooks";
import type { StrandsPuzzle } from "../../lib/strands-types";
import { strandsWordKey } from "../../lib/strands-types";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";

interface StrandsListProps {
  puzzle: StrandsPuzzle;
  locale: Locale;
  foundKeys: string[];
  headingLevel?: 2 | 3;
}

/** Theme words as chips; the spangram is marked in text and class. */
export function StrandsList({
  puzzle,
  locale,
  foundKeys,
  headingLevel = 2,
}: StrandsListProps) {
  const t = getMessages(locale).strands;
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <aside class="strands-list word-search-list-section" aria-label={t.wordsHeading}>
      <Heading id={headingId} class="word-search-list-heading">
        {t.wordsHeading}
      </Heading>
      <ul class="word-search-words" role="list" aria-labelledby={headingId}>
        {puzzle.words.map((word, index) => {
          const key = strandsWordKey(word);
          const found = foundKeys.includes(key);
          const name = word.labels[locale] || word.labels.en;
          const classes = [
            "word-search-item",
            word.is_spangram ? "is-spangram" : "",
            found ? `is-found color-${index % 6}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={key}
              class={classes}
              data-word-key={key}
              data-spangram={word.is_spangram ? "true" : undefined}
            >
              {found && <span class="found-check" aria-hidden="true">✓</span>}
              <span class={found ? "text-found" : "text-pending"}>
                {found
                  ? name
                  : word.is_spangram
                    ? `${t.spangramLabel} (${t.lettersCount(word.word.length)})`
                    : t.lettersCount(word.word.length)}
              </span>
              {found && (
                <span class="visually-hidden">
                  {`, ${word.is_spangram ? t.spangramFound : t.foundState}`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
