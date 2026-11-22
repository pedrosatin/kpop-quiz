import type { TimelineCardProps } from "./types";
import { TimelineMoveButton } from "./timeline-move-button";
import {
  cardMoveLimits,
  timelineCardClass,
  timelineCardMoveLabels,
  timelineEventDescription,
  timelineEventTitle,
} from "./timeline-board-state";

type CardDragProps = Pick<TimelineCardProps, "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "onDragEnd">;

function cardDragHandlers(index: number, isSubmitted: boolean, handlers: CardDragProps) {
  return {
    onDragStart: (e: DragEvent) => {
      if (!isSubmitted) handlers.onDragStart?.(index, e);
    },
    onDragOver: (e: DragEvent) => {
      if (!isSubmitted) handlers.onDragOver?.(index, e);
    },
    onDragLeave: (e: DragEvent) => {
      if (!isSubmitted) handlers.onDragLeave?.(index, e);
    },
    onDrop: (e: DragEvent) => {
      if (!isSubmitted) handlers.onDrop?.(index, e);
    },
    onDragEnd: (e: DragEvent) => {
      if (!isSubmitted) handlers.onDragEnd?.(e);
    },
  };
}

export function TimelineCard({
  event,
  index,
  totalEvents,
  locale = "pt-BR",
  gameStatus = "in_progress",
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragging = false,
  isDragOver = false,
  messages,
}: TimelineCardProps) {
  const isSubmitted = gameStatus === "submitted";
  const { upDisabled, downDisabled } = cardMoveLimits({ index, totalEvents, isSubmitted, canMoveUp, canMoveDown });
  const labels = timelineCardMoveLabels(locale, messages);
  const title = timelineEventTitle(event, locale);
  const description = timelineEventDescription(event, locale);

  return (
    <li
      class={timelineCardClass(isDragging, isDragOver, isSubmitted)}
      role="listitem"
      draggable={!isSubmitted}
      {...cardDragHandlers(index, isSubmitted, { onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd })}
      data-testid={`timeline-card-${event.id}`}
      data-index={index}
    >
      <div class="timeline-card-header">
        <div class="timeline-card-badge-wrap">
          <span class="timeline-card-badge">#{index + 1}</span>
          <span
            class={`timeline-drag-handle${isSubmitted ? " is-disabled" : ""}`}
            aria-hidden="true"
          >
            ⋮⋮
          </span>
        </div>
        <div class="timeline-card-actions">
          <TimelineMoveButton
            eventId={event.id}
            direction="up"
            label={labels.moveUp(title)}
            disabled={upDisabled}
            onMove={() => onMoveUp?.(index)}
          />
          <TimelineMoveButton
            eventId={event.id}
            direction="down"
            label={labels.moveDown(title)}
            disabled={downDisabled}
            onMove={() => onMoveDown?.(index)}
          />
        </div>
      </div>
      <div class="timeline-card-body">
        <h3 class="timeline-card-title">{title}</h3>
        {description && <p class="timeline-card-description">{description}</p>}
      </div>
    </li>
  );
}
