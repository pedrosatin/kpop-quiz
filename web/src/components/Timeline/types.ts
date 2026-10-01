import type { Locale, TimelineEvent } from "../../lib/quiz-types";

export type TimelineGameStatus = "in_progress" | "submitted";

export interface TimelineStoredState {
  puzzleId: string;
  referenceDate: string;
  orderedEventIds: string[];
  submitted: boolean;
  score: number;
  results: boolean[];
}

export interface TimelineCardMessages {
  moveUp: (title: string) => string;
  moveDown: (title: string) => string;
  positionBadge?: ((position: number) => string) | undefined;
  dragHandle?: ((title: string) => string) | undefined;
}

export interface TimelineBoardMessages extends TimelineCardMessages {
  boardAria: string;
  itemMoved: (title: string, position: number, total: number) => string;
  submit: string;
}

export const DEFAULT_TIMELINE_MESSAGES: Record<Locale, TimelineBoardMessages> = {
  "pt-BR": {
    boardAria: "Linha do tempo de eventos",
    moveUp: (title: string) => `Mover "${title}" para cima`,
    moveDown: (title: string) => `Mover "${title}" para baixo`,
    itemMoved: (title: string, position: number, total: number) =>
      `${title} movido para a posição ${position} de ${total}`,
    submit: "Verificar ordem",
    positionBadge: (pos: number) => `Posição ${pos}`,
    dragHandle: (title: string) => `Arrastar "${title}" para reordenar`,
  },
  en: {
    boardAria: "Event timeline",
    moveUp: (title: string) => `Move "${title}" up`,
    moveDown: (title: string) => `Move "${title}" down`,
    itemMoved: (title: string, position: number, total: number) =>
      `${title} moved to position ${position} of ${total}`,
    submit: "Check order",
    positionBadge: (pos: number) => `Position ${pos}`,
    dragHandle: (title: string) => `Drag "${title}" to reorder`,
  },
};

export interface TimelineCardProps {
  event: TimelineEvent;
  index: number;
  totalEvents: number;
  locale?: Locale | undefined;
  gameStatus?: TimelineGameStatus | undefined;
  canMoveUp?: boolean | undefined;
  canMoveDown?: boolean | undefined;
  onMoveUp?: ((index: number) => void) | undefined;
  onMoveDown?: ((index: number) => void) | undefined;
  onDragStart?: ((index: number, event: DragEvent) => void) | undefined;
  onDragOver?: ((index: number, event: DragEvent) => void) | undefined;
  onDragLeave?: ((index: number, event: DragEvent) => void) | undefined;
  onDrop?: ((index: number, event: DragEvent) => void) | undefined;
  onDragEnd?: ((event: DragEvent) => void) | undefined;
  isDragging?: boolean | undefined;
  isDragOver?: boolean | undefined;
  messages?: Partial<TimelineCardMessages> | undefined;
}

export interface TimelineBoardProps {
  events: TimelineEvent[];
  locale?: Locale | undefined;
  gameStatus?: TimelineGameStatus | undefined;
  onMoveUp?: ((index: number) => void) | undefined;
  onMoveDown?: ((index: number) => void) | undefined;
  onReorder?: ((fromIndex: number, toIndex: number) => void) | undefined;
  onSubmit?: (() => void) | undefined;
  messages?: Partial<TimelineBoardMessages> | undefined;
}

export interface TimelineControlsProps {
  gameStatus?: TimelineGameStatus | undefined;
  onSubmit: () => void;
  locale?: Locale | undefined;
  messages?: {
    submit: string;
  } | undefined;
  disabled?: boolean | undefined;
}
