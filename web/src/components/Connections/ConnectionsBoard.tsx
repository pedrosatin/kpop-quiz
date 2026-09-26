import { useLayoutEffect, useRef } from "preact/hooks";
import type { ConnectionsBoardProps } from "./types";
import { CategoryBanner } from "./CategoryBanner";
import { ConnectionsTile } from "./ConnectionsTile";

// Tile font range in px at a 16px root (scaled with the root size): the
// largest size a name keeps, and the smallest before a word may break inside.
const TILE_FONT_MAX = 15;
const TILE_FONT_MIN = 11;
const TILE_FONT_STEP = 0.5;

/**
 * Shrinks a tile's name until every word fits its width and the text fits
 * its height. If no size fits, the name may break after ":", "-",
 * "." or "/" (class has-breaks) and the sizes are tried again. A word still too wide
 * at the smallest size breaks anywhere (class is-broken), so no letter is
 * ever cut off.
 */
export function fitTileText(tile: HTMLElement, rootPx: number): void {
  const text = tile.querySelector<HTMLElement>(".connections-tile-text");
  if (!text) return;
  text.classList.remove("has-breaks", "is-broken");
  const style = getComputedStyle(tile);
  const maxHeight =
    tile.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const fits = () => text.scrollWidth <= text.clientWidth + 0.5 && text.offsetHeight <= maxHeight + 0.5;
  const steps = (TILE_FONT_MAX - TILE_FONT_MIN) / TILE_FONT_STEP;
  const shrink = () => {
    for (let i = 0; i <= steps; i++) {
      text.style.fontSize = `${((TILE_FONT_MAX - i * TILE_FONT_STEP) * rootPx) / 16}px`;
      if (fits()) return true;
    }
    return false;
  };
  if (shrink()) return;
  if (text.querySelector(".connections-tile-break")) {
    text.classList.add("has-breaks");
    if (shrink()) return;
  }
  text.classList.add("is-broken");
}

export function ConnectionsBoard({
  categories,
  solvedCategoryIds,
  boardItems,
  allItems,
  selectedItemIds,
  onToggleItem,
  disabled = false,
  gridRef,
  locale,
  messages,
}: ConnectionsBoardProps) {
  const solvedCategories = categories
    .filter((cat) => solvedCategoryIds.includes(cat.id))
    .sort((a, b) => a.difficulty_level - b.difficulty_level);

  const itemsList = allItems ?? boardItems;
  const ownGrid = useRef<HTMLDivElement>(null);
  const grid = gridRef ?? ownGrid;

  // Fit each name to its tile before paint, and again when the tiles resize.
  const itemKey = boardItems.map((item) => item.id).join(",");
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const fitAll = () => {
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      node.querySelectorAll<HTMLElement>(".connections-tile").forEach((tile) => fitTileText(tile, rootPx));
    };
    fitAll();
    if (typeof ResizeObserver === "undefined") return;
    // Fitting never changes the tile size (fixed rows and columns), so this
    // cannot loop.
    const observer = new ResizeObserver(fitAll);
    observer.observe(node);
    return () => observer.disconnect();
  }, [itemKey, locale]);

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
          ref={grid}
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
