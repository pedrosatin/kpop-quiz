import { useCallback, useEffect, useState } from "preact/hooks";
import type { Locale, TimelineEvent } from "../../lib/quiz-types";
import type { TimelineBoardMessages } from "./types";
import {
  buttonMoveTarget,
  focusAfterMoveId,
  isBoardIndex,
  moveItem,
  swapItems,
  timelineEventTitle,
  type MoveDirection,
} from "./timeline-board-state";

interface UseTimelineBoardItemsProps {
  events: TimelineEvent[];
  locale: Locale;
  isSubmitted: boolean;
  messages: TimelineBoardMessages;
  onMoveUp?: ((index: number) => void) | undefined;
  onMoveDown?: ((index: number) => void) | undefined;
  onReorder?: ((fromIndex: number, toIndex: number) => void) | undefined;
}

/**
 * The order on screen, which follows `events` and changes at once on a move,
 * the live announcement of the last move, and the focus kept on the moved card.
 */
export function useTimelineBoardItems({
  events,
  locale,
  isSubmitted,
  messages,
  onMoveUp,
  onMoveDown,
  onReorder,
}: UseTimelineBoardItemsProps) {
  const [items, setItems] = useState<TimelineEvent[]>(events);
  const [announcement, setAnnouncement] = useState<string>("");
  const [lastMoved, setLastMoved] = useState<{ id: string; direction: MoveDirection } | null>(null);

  useEffect(() => {
    setItems(events);
  }, [events]);

  const moveByButton = useCallback(
    (index: number, direction: MoveDirection) => {
      if (isSubmitted) return;
      const targetIndex = buttonMoveTarget(index, direction, items.length);
      if (targetIndex === null) return;
      const currentItem = items[index]!;
      const nextItems = swapItems(items, index, targetIndex);
      setItems(nextItems);

      const title = timelineEventTitle(currentItem, locale);
      setAnnouncement(messages.itemMoved(title, targetIndex + 1, nextItems.length));
      setLastMoved({ id: currentItem.id, direction });

      const onMove = direction === "up" ? onMoveUp : onMoveDown;
      onMove?.(index);
      onReorder?.(index, targetIndex);
    },
    [isSubmitted, items, locale, messages, onMoveUp, onMoveDown, onReorder]
  );

  const moveByDrag = useCallback(
    (from: number, targetIndex: number) => {
      if (!isBoardIndex(targetIndex, items.length) || !isBoardIndex(from, items.length)) return;
      const currentItem = items[from]!;
      setItems((prev) => moveItem(prev, from, targetIndex));
      const title = timelineEventTitle(currentItem, locale);
      setAnnouncement(messages.itemMoved(title, targetIndex + 1, items.length));
    },
    [items, locale, messages]
  );

  useEffect(() => {
    if (!lastMoved) return;
    const { id, direction } = lastMoved;
    const newIndex = items.findIndex((e) => e.id === id);
    if (newIndex !== -1) {
      document.getElementById(focusAfterMoveId(id, newIndex, items.length, direction))?.focus();
    }
    setLastMoved(null);
  }, [items, lastMoved]);

  return { items, announcement, moveByButton, moveByDrag };
}
