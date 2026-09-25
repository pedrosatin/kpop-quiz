import type { CategoryBannerProps } from "./types";

export function CategoryBanner({
  category,
  allItems,
  items,
  locale,
  messages,
}: CategoryBannerProps) {
  const itemsList = allItems ?? items ?? [];
  const itemNames = category.item_ids
    .map(
      (id) =>
        itemsList.find((i) => i.id === id)?.labels[locale] ||
        itemsList.find((i) => i.id === id)?.canonical_name ||
        id
    )
    .join(", ");

  const categoryLabel = category.label[locale] || category.label["pt-BR"];
  const categoryExplanation = category.explanation[locale] || category.explanation["pt-BR"];

  const ariaDescription = messages.connectionsCategorySolvedAria
    ? messages.connectionsCategorySolvedAria(category.difficulty_level, categoryLabel, itemNames)
    : `${categoryLabel}: ${itemNames}`;

  return (
    <div
      class={`connections-banner connections-banner-level-${category.difficulty_level}`}
      role="region"
      aria-label={ariaDescription}
    >
      <div class="connections-banner-content">
        <h3 class="connections-banner-title">
          <span class="visually-hidden">{messages.connectionsLevelAria} {category.difficulty_level}: </span>
          {categoryLabel}
        </h3>
        <p class="connections-banner-items">{itemNames}</p>
        <p class="connections-banner-explanation">{categoryExplanation}</p>
      </div>
    </div>
  );
}
