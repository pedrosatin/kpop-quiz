import type { Locale, TimelineEvent } from "../../lib/quiz-types";
import type { TimelineBoardMessages, TimelineCardMessages } from "./types";
import { defaultTimelineMessages } from "./types";

export type MoveDirection = "up" | "down";

/** The card title in `locale`, then in Portuguese, then the entity name. */
export function timelineEventTitle(event: TimelineEvent, locale: Locale): string {
  return event.title[locale] || event.title["pt-BR"] || event.entity_name;
}

/** The card description in `locale`, then in Portuguese, else empty. */
export function timelineEventDescription(event: TimelineEvent, locale: Locale): string {
  return event.description[locale] || event.description["pt-BR"] || "";
}

/** The built-in board copy for `locale`, with each custom message on top. */
export function timelineBoardMessages(
  locale: Locale,
  custom: Partial<TimelineBoardMessages> | undefined,
): TimelineBoardMessages {
  return { ...defaultTimelineMessages(locale), ...custom };
}

/** The labels of a card's move buttons: the custom one, else the built-in one. */
export function timelineCardMoveLabels(
  locale: Locale,
  messages: Partial<TimelineCardMessages> | undefined,
): Pick<TimelineCardMessages, "moveUp" | "moveDown"> {
  const fallback = defaultTimelineMessages(locale);
  return {
    moveUp: messages?.moveUp ?? fallback.moveUp,
    moveDown: messages?.moveDown ?? fallback.moveDown,
  };
}

/** Whether `index` points at a card of a board with `length` cards. */
export function isBoardIndex(index: number, length: number): boolean {
  return !isNaN(index) && index >= 0 && index < length;
}

/** Where a move button sends the card at `index`, or null when the card is already at that end. */
export function buttonMoveTarget(index: number, direction: MoveDirection, length: number): number | null {
  const target = direction === "up" ? index - 1 : index + 1;
  if (!isBoardIndex(index, length) || !isBoardIndex(target, length)) return null;
  return target;
}

/** A copy of `items` with the items at `index` and `target` swapped. */
export function swapItems<T>(items: readonly T[], index: number, target: number): T[] {
  const next = [...items];
  const current = next[index]!;
  next[index] = next[target]!;
  next[target] = current;
  return next;
}

/** A copy of `items` with the item at `from` moved to `to`; `items` itself when `from` holds nothing. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (!item) return items;
  next.splice(to, 0, item);
  return next;
}

/**
 * The index a drop moves the card from: the index written to the drag payload,
 * else the card where the drag started.
 */
export function dropSourceIndex(payload: string | undefined, dragIndex: number | null): number | null {
  if (payload === undefined || payload === "") return dragIndex;
  return parseInt(payload, 10);
}

/**
 * The button that keeps focus after a move: the button that moved the card,
 * or the one that still works when the card reached an end of the board.
 */
export function focusAfterMoveId(eventId: string, newIndex: number, length: number, direction: MoveDirection): string {
  if (newIndex === 0) return `timeline-move-down-${eventId}`;
  if (newIndex === length - 1) return `timeline-move-up-${eventId}`;
  return `timeline-move-${direction}-${eventId}`;
}

interface CardMoveLimitsInput {
  index: number;
  totalEvents: number;
  isSubmitted: boolean;
  canMoveUp: boolean | undefined;
  canMoveDown: boolean | undefined;
}

function isMoveDisabled(isSubmitted: boolean, allowed: boolean | undefined, atEnd: boolean): boolean {
  if (isSubmitted) return true;
  if (allowed !== undefined) return !allowed;
  return atEnd;
}

/** Which of a card's move buttons are off. Explicit limits win over the card's index. */
export function cardMoveLimits({ index, totalEvents, isSubmitted, canMoveUp, canMoveDown }: CardMoveLimitsInput) {
  return {
    upDisabled: isMoveDisabled(isSubmitted, canMoveUp, index <= 0),
    downDisabled: isMoveDisabled(isSubmitted, canMoveDown, index >= totalEvents - 1),
  };
}

/** The class list of a card for its drag and submit state. */
export function timelineCardClass(isDragging: boolean, isDragOver: boolean, isSubmitted: boolean): string {
  let name = "timeline-card";
  if (isDragging) name += " is-dragging";
  if (isDragOver) name += " is-drag-over";
  if (isSubmitted) name += " is-submitted";
  return name;
}
