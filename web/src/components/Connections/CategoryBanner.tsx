import type { CategoryBannerProps } from "./types";
import { DIFFICULTY_COLORS } from "./types";

export function CategoryBanner({
  category,
  items,
  locale,
  messages,
}: CategoryBannerProps) {
  const color = DIFFICULTY_COLORS[category.difficulty_level];
  const itemNames = category.item_ids
    .map((id) => {
      const found = items.find((i) => i.id === id);
      return found ? (found.labels[locale] || found.canonical_name) : id;
    })
    .join(", ");

  const categoryLabel = category.label[locale] || category.label["pt-BR"];
  const categoryExplanation = category.explanation[locale] || category.explanation["pt-BR"];

  const ariaDescription = messages.connectionsCategorySolvedAria
    ? messages.connectionsCategorySolvedAria(category.difficulty_level, categoryLabel, itemNames)
    : `${categoryLabel}: ${itemNames}`;

  return (
    <div
      class={`connections-banner difficulty-${category.difficulty_level}`}
      style={{
        backgroundColor: color.bg,
        color: color.text,
      }}
      role="region"
      aria-label={ariaDescription}
    >
      <div class="connections-banner-content">
        <h3 class="connections-banner-title">
          <span class="visually-hidden">Nível {category.difficulty_level}: </span>
          {categoryLabel}
        </h3>
        <p class="connections-banner-items">{itemNames}</p>
        <p class="connections-banner-explanation">{categoryExplanation}</p>
      </div>
    </div>
  );
}
