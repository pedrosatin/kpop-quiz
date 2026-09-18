import type { ConnectionsBoardProps } from "./types";
import { CategoryBanner } from "./CategoryBanner";
import { ConnectionsTile } from "./ConnectionsTile";

export function ConnectionsBoard({
  categories,
  solvedCategoryIds,
  boardItems,
  allItems,
  selectedItemIds,
  onToggleItem,
  disabled = false,
  locale,
  messages,
}: ConnectionsBoardProps) {
  const solvedCategories = categories
    .filter((cat) => solvedCategoryIds.includes(cat.id))
    .sort((a, b) => a.difficulty_level - b.difficulty_level);

  const itemsList = allItems ?? boardItems;

  return (
    <div
      class="connections-board"
      role="region"
      aria-label={messages.connectionsBoardAria}
    >
      {solvedCategories.length > 0 && (
        <div
          class="connections-solved-categories"
          aria-label={messages.connectionsSolvedAria}
        >
          {solvedCategories.map((cat) => (
            <CategoryBanner
              key={cat.id}
              category={cat}
              allItems={itemsList}
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
          aria-label={messages.connectionsItemsAria}
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
