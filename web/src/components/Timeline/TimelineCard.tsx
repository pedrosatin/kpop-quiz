import type { TimelineCardProps } from "./types";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";

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
  const upDisabled = isSubmitted || (canMoveUp !== undefined ? !canMoveUp : index <= 0);
  const downDisabled =
    isSubmitted || (canMoveDown !== undefined ? !canMoveDown : index >= totalEvents - 1);

  const fallback =
    DEFAULT_TIMELINE_MESSAGES[locale] || DEFAULT_TIMELINE_MESSAGES["pt-BR"];
  const moveUpLabel = messages?.moveUp ?? fallback.moveUp;
  const moveDownLabel = messages?.moveDown ?? fallback.moveDown;

  const title = event.title[locale] || event.title["pt-BR"] || event.entity_name;
  const description = event.description[locale] || event.description["pt-BR"] || "";

  return (
    <li
      class={`timeline-card${isDragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}${isSubmitted ? " is-submitted" : ""}`}
      role="listitem"
      draggable={!isSubmitted}
      onDragStart={(e) => {
        if (!isSubmitted) onDragStart?.(index, e);
      }}
      onDragOver={(e) => {
        if (!isSubmitted) onDragOver?.(index, e);
      }}
      onDragLeave={(e) => {
        if (!isSubmitted) onDragLeave?.(index, e);
      }}
      onDrop={(e) => {
        if (!isSubmitted) onDrop?.(index, e);
      }}
      onDragEnd={(e) => {
        if (!isSubmitted) onDragEnd?.(e);
      }}
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
          <button
            type="button"
            id={`timeline-move-up-${event.id}`}
            class="btn btn-icon timeline-btn timeline-btn-up"
            aria-label={moveUpLabel(title)}
            disabled={upDisabled}
            onClick={() => {
              if (!upDisabled) onMoveUp?.(index);
            }}
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault();
            }}
          >
            ↑
          </button>
          <button
            type="button"
            id={`timeline-move-down-${event.id}`}
            class="btn btn-icon timeline-btn timeline-btn-down"
            aria-label={moveDownLabel(title)}
            disabled={downDisabled}
            onClick={() => {
              if (!downDisabled) onMoveDown?.(index);
            }}
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault();
            }}
          >
            ↓
          </button>
        </div>
      </div>
      <div class="timeline-card-body">
        <h3 class="timeline-card-title">{title}</h3>
        {description && <p class="timeline-card-description">{description}</p>}
      </div>
    </li>
  );
}
