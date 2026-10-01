import { useCallback, useEffect, useState } from "preact/hooks";
import type { TimelineEvent } from "../../lib/timeline-types";
import { TimelineCard } from "./TimelineCard";
import { TimelineControls } from "./TimelineControls";
import { useTimelineBoardDrag } from "./useTimelineBoardDrag";
import type { TimelineBoardProps, TimelineBoardMessages } from "./types";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";

export function TimelineBoard({
  events,
  locale = "pt-BR",
  gameStatus = "in_progress",
  onMoveUp,
  onMoveDown,
  onReorder,
  onSubmit,
  messages: customMessages,
}: TimelineBoardProps) {
  const [items, setItems] = useState<TimelineEvent[]>(events);
  const [announcement, setAnnouncement] = useState<string>("");
  const [lastMoved, setLastMoved] = useState<{ id: string; action: "up" | "down" } | null>(null);

  useEffect(() => {
    setItems(events);
  }, [events]);

  const defaultMsgs = DEFAULT_TIMELINE_MESSAGES[locale] || DEFAULT_TIMELINE_MESSAGES["pt-BR"];
  const boardMessages: TimelineBoardMessages = {
    ...defaultMsgs,
    ...customMessages,
  };
  const messages = boardMessages;

  const isSubmitted = gameStatus === "submitted";

  const handleMoveUp = useCallback(
    (index: number) => {
      if (isSubmitted || index <= 0 || index >= items.length) return;
      const targetIndex = index - 1;
      const currentItem = items[index]!;
      const nextItems = [...items];
      nextItems[index] = nextItems[targetIndex]!;
      nextItems[targetIndex] = currentItem;
      setItems(nextItems);

      const title = currentItem.title[locale] || currentItem.title["pt-BR"] || currentItem.entity_name;
      setAnnouncement(messages.itemMoved(title, targetIndex + 1, nextItems.length));
      setLastMoved({ id: currentItem.id, action: "up" });

      onMoveUp?.(index);
      onReorder?.(index, targetIndex);
    },
    [isSubmitted, items, locale, messages, onMoveUp, onReorder]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (isSubmitted || index < 0 || index >= items.length - 1) return;
      const targetIndex = index + 1;
      const currentItem = items[index]!;
      const nextItems = [...items];
      nextItems[index] = nextItems[targetIndex]!;
      nextItems[targetIndex] = currentItem;
      setItems(nextItems);

      const title = currentItem.title[locale] || currentItem.title["pt-BR"] || currentItem.entity_name;
      setAnnouncement(messages.itemMoved(title, targetIndex + 1, nextItems.length));
      setLastMoved({ id: currentItem.id, action: "down" });

      onMoveDown?.(index);
      onReorder?.(index, targetIndex);
    },
    [isSubmitted, items, locale, messages, onMoveDown, onReorder]
  );

  const handleDragMoved = useCallback(
    (from: number, targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= items.length || isNaN(targetIndex)) return;
      if (from < 0 || from >= items.length || isNaN(from)) return;
      const currentItem = items[from]!;
      setItems((prev) => {
        const next = [...prev];
        const [item] = next.splice(from, 1);
        if (!item) return prev;
        next.splice(targetIndex, 0, item);
        return next;
      });
      const title = currentItem.title[locale] || currentItem.title["pt-BR"] || currentItem.entity_name;
      setAnnouncement(messages.itemMoved(title, targetIndex + 1, items.length));
    },
    [items, locale, messages]
  );

  const {
    dragIndex,
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  } = useTimelineBoardDrag({
    items,
    isSubmitted,
    onReorder,
    onMoved: handleDragMoved,
  });

  useEffect(() => {
    if (!lastMoved) return;
    const { id, action } = lastMoved;
    const newIndex = items.findIndex((e) => e.id === id);
    if (newIndex === -1) {
      setLastMoved(null);
      return;
    }

    let targetId: string;
    if (newIndex === 0) {
      targetId = `timeline-move-down-${id}`;
    } else if (newIndex === items.length - 1) {
      targetId = `timeline-move-up-${id}`;
    } else {
      targetId = action === "up" ? `timeline-move-up-${id}` : `timeline-move-down-${id}`;
    }
    document.getElementById(targetId)?.focus();
    setLastMoved(null);
  }, [items, lastMoved]);

  return (
    <div class="timeline-board-wrapper">
      <div class="timeline-live-region visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <h2 id="timeline-board-heading" class="visually-hidden">
        {boardMessages.boardAria}
      </h2>
      <ol class="timeline-board-list" role="list" aria-label={messages.boardAria}>
        {items.map((event, index) => (
          <TimelineCard
            key={event.id}
            event={event}
            index={index}
            totalEvents={items.length}
            locale={locale}
            gameStatus={gameStatus}
            canMoveUp={gameStatus === "in_progress" && index > 0}
            canMoveDown={gameStatus === "in_progress" && index < items.length - 1}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            isDragging={dragIndex === index}
            isDragOver={dragOverIndex === index}
            messages={messages}
          />
        ))}
      </ol>

      {onSubmit && (
        <TimelineControls
          gameStatus={gameStatus}
          onSubmit={onSubmit}
          locale={locale}
          messages={messages}
        />
      )}
    </div>
  );
}
