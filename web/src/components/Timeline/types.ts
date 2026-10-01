export type TimelineGameStatus = "in_progress" | "submitted";

export interface TimelineStoredState {
  puzzleId: string;
  referenceDate: string;
  orderedEventIds: string[];
  submitted: boolean;
  score: number;
  results: boolean[];
}
