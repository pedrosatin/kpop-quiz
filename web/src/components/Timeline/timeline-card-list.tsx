import type { Ref } from "preact";
import type { Locale, TimelineEvent } from "../../lib/quiz-types";
import { TimelineCard } from "./TimelineCard";
import type { MoveDirection } from "./timeline-board-state";
import type { TimelineBoardMessages, TimelineGameStatus } from "./types";
import type { useTimelineBoardDrag } from "./useTimelineBoardDrag";

interface TimelineCardListProps {
  items: TimelineEvent[];
  locale: Locale;
  gameStatus: TimelineGameStatus;
  messages: TimelineBoardMessages;
  drag: ReturnType<typeof useTimelineBoardDrag>;
  onMove: (index: number, direction: MoveDirection) => void;
  listRef: Ref<HTMLOListElement>;
}

/** The ordered list of cards, each with its move limits and drag state. */
export function TimelineCardList({ items, locale, gameStatus, messages, drag, onMove, listRef }: TimelineCardListProps) {
  const isPlaying = gameStatus === "in_progress";
  return (
    <ol ref={listRef} class="timeline-board-list" role="list" aria-label={messages.boardAria}>
      {items.map((event, index) => (
        <TimelineCard
          key={event.id}
          event={event}
          index={index}
          totalEvents={items.length}
          locale={locale}
          gameStatus={gameStatus}
          canMoveUp={isPlaying && index > 0}
          canMoveDown={isPlaying && index < items.length - 1}
          onMoveUp={() => onMove(index, "up")}
          onMoveDown={() => onMove(index, "down")}
          onDragStart={drag.handleDragStart}
          onDragOver={drag.handleDragOver}
          onDragLeave={drag.handleDragLeave}
          onDrop={drag.handleDrop}
          onDragEnd={drag.handleDragEnd}
          isDragging={drag.dragIndex === index}
          isDragOver={drag.dragOverIndex === index}
          messages={messages}
        />
      ))}
    </ol>
  );
}
