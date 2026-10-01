import type { RefObject } from "preact";
import type { Messages } from "../../i18n/catalog";
import type { Locale, TimelineEvent, TimelinePuzzle } from "../../lib/quiz-types";

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

export interface TimelineShareMessages {
  share: string;
  copiedToClipboard: string;
  shareFailed: string;
  shareTextLabel: string;
}

export interface TimelineResultsMessages extends TimelineShareMessages {
  scoreBanner: (score: number, totalEvents: number) => string;
  summaryHeading: string;
  correctPosition: string;
  incorrectPosition: string;
  viewEvidence: string;
  revision: string;
}

export interface TimelineMessages extends TimelineBoardMessages, TimelineResultsMessages {}

export const DEFAULT_TIMELINE_MESSAGES: Record<Locale, TimelineMessages> = {
  "pt-BR": {
    boardAria: "Linha do tempo de eventos",
    moveUp: (title: string) => `Mover "${title}" para cima`,
    moveDown: (title: string) => `Mover "${title}" para baixo`,
    itemMoved: (title: string, position: number, total: number) =>
      `${title} movido para a posição ${position} de ${total}`,
    submit: "Verificar ordem",
    positionBadge: (pos: number) => `Posição ${pos}`,
    dragHandle: (title: string) => `Arrastar "${title}" para reordenar`,
    scoreBanner: (score: number, total: number) => `Pontuação: ${score}/${total}`,
    summaryHeading: "Ordem cronológica correta",
    correctPosition: "Posição correta",
    incorrectPosition: "Posição incorreta",
    viewEvidence: "Ver fontes e evidências",
    revision: "revisão",
    share: "Compartilhar",
    copiedToClipboard: "Copiado para a área de transferência!",
    shareFailed: "Não deu para copiar. Selecione o texto abaixo e copie.",
    shareTextLabel: "Texto do resultado para cópia manual",
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
    scoreBanner: (score: number, total: number) => `Score: ${score}/${total}`,
    summaryHeading: "Correct chronological order",
    correctPosition: "Correct position",
    incorrectPosition: "Incorrect position",
    viewEvidence: "View sources and evidence",
    revision: "revision",
    share: "Share",
    copiedToClipboard: "Copied to clipboard!",
    shareFailed: "Could not copy. Select the text below and copy it.",
    shareTextLabel: "Result text for manual copy",
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

export interface TimelineShareProps {
  shareText: string;
  locale?: Locale | undefined;
  messages?: Partial<TimelineShareMessages> | undefined;
  onShareSuccess?: (() => void) | undefined;
  onShareError?: (() => void) | undefined;
}

export interface TimelineResultsProps {
  score: number;
  totalEvents?: number | undefined;
  results: boolean[];
  canonicalEvents?: TimelineEvent[] | undefined;
  events?: TimelineEvent[] | undefined;
  referenceDate?: string | undefined;
  shareText: string;
  locale?: Locale | undefined;
  onShareSuccess?: (() => void) | undefined;
  onShareError?: (() => void) | undefined;
  onCopied?: (() => void) | undefined;
  onShareFailed?: (() => void) | undefined;
  messages?: Partial<TimelineResultsMessages> | undefined;
  titleRef?: RefObject<HTMLHeadingElement> | undefined;
}

export interface TimelineGameProps {
  locale: Locale;
  baseUrl?: string | undefined;
  messages?: Messages | undefined;
  puzzle?: TimelinePuzzle | undefined;
}
