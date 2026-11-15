import { TimelineCardList } from "./timeline-card-list";
import { TimelineControls } from "./TimelineControls";
import { timelineBoardMessages } from "./timeline-board-state";
import { useTimelineBoardDrag } from "./useTimelineBoardDrag";
import { useTimelineBoardItems } from "./useTimelineBoardItems";
import type { TimelineBoardProps } from "./types";

export function TimelineBoard({
  events,
  locale = "pt-BR",
  gameStatus = "in_progress",
  onMoveUp,
  onMoveDown,
  onReorder,
  onSubmit,
  onGiveUp,
  messages: customMessages,
}: TimelineBoardProps) {
  const messages = timelineBoardMessages(locale, customMessages);
  const isSubmitted = gameStatus === "submitted";

  const { items, announcement, moveByButton, moveByDrag } = useTimelineBoardItems({
    events,
    locale,
    isSubmitted,
    messages,
    onMoveUp,
    onMoveDown,
    onReorder,
  });

  const drag = useTimelineBoardDrag({
    items,
    isSubmitted,
    onReorder,
    onMoved: moveByDrag,
  });

  // While a card is dragged, timeline.css hides the sticky action bar so the
  // browser's autoscroll zone and the drop land on the cards under it.
  return (
    <div class={drag.dragIndex === null ? "timeline-board-wrapper" : "timeline-board-wrapper is-dragging"}>
      <div class="timeline-live-region visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <h2 id="timeline-board-heading" class="visually-hidden">
        {messages.boardAria}
      </h2>
      <TimelineCardList
        items={items}
        locale={locale}
        gameStatus={gameStatus}
        messages={messages}
        drag={drag}
        onMove={moveByButton}
      />

      {onSubmit && (
        <TimelineControls
          gameStatus={gameStatus}
          onSubmit={onSubmit}
          onGiveUp={onGiveUp}
          locale={locale}
          messages={messages}
        />
      )}
    </div>
  );
}
