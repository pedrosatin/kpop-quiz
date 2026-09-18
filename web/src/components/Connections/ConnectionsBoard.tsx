import type { ConnectionsBoardProps } from "./types";
import { CategoryBanner } from "./CategoryBanner";
import { ConnectionsTile } from "./ConnectionsTile";

export function ConnectionsBoard({
  categories,
  solvedCategoryIds,
  boardItems,
  selectedItemIds,
  onToggleItem,
  disabled = false,
  locale,
  messages,
}: ConnectionsBoardProps) {
  const solvedCategories = categories
    .filter((cat) => solvedCategoryIds.includes(cat.id))
    .sort((a, b) => a.difficulty_level - b.difficulty_level);

  return (
    <div class="connections-board" role="region" aria-label="Tabuleiro">
      {solvedCategories.length > 0 && (
        <div class="connections-solved-categories" aria-label="Categorias resolvidas">
          {solvedCategories.map((cat) => (
            <CategoryBanner
              key={cat.id}
              category={cat}
              items={boardItems}
              locale={locale}
              messages={messages}
            />
          ))}
        </div>
      )}

      {boardItems.length > 0 && (
        <div
          class="connections-grid"
          role="group"
          aria-label="Itens para agrupamento"
        >
          {boardItems.map((item) => (
            <ConnectionsTile
              key={item.id}
              item={item}
              isSelected={selectedItemIds.includes(item.id)}
              disabled={disabled}
              onToggle={onToggleItem}
              locale={locale}
              messages={messages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
