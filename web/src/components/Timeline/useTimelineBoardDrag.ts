import { useCallback, useState } from "preact/hooks";
import type { TimelineEvent } from "../../lib/timeline-types";
import { dropSourceIndex, isBoardIndex } from "./timeline-board-state";

interface UseTimelineBoardDragProps {
  items: TimelineEvent[];
  isSubmitted: boolean;
  onReorder?: ((fromIndex: number, toIndex: number) => void) | undefined;
  onMoved: (fromIndex: number, toIndex: number) => void;
}

export function useTimelineBoardDrag({
  items,
  isSubmitted,
  onReorder,
  onMoved,
}: UseTimelineBoardDragProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (index: number, e: DragEvent) => {
      if (isSubmitted) return;
      setDragIndex(index);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
      }
    },
    [isSubmitted]
  );

  const handleDragOver = useCallback(
    (index: number, e: DragEvent) => {
      if (isSubmitted) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setDragOverIndex(index);
    },
    [isSubmitted]
  );

  const handleDragLeave = useCallback(
    (index: number) => {
      if (dragOverIndex === index) setDragOverIndex(null);
    },
    [dragOverIndex]
  );

  const handleDrop = useCallback(
    (targetIndex: number, e: DragEvent) => {
      if (isSubmitted) return;
      e.preventDefault();
      const from = dropSourceIndex(e.dataTransfer?.getData("text/plain"), dragIndex);
      setDragIndex(null);
      setDragOverIndex(null);

      if (from === null || from === targetIndex || !isBoardIndex(from, items.length)) return;
      if (!isBoardIndex(targetIndex, items.length)) return;

      onMoved(from, targetIndex);
      onReorder?.(from, targetIndex);
    },
    [isSubmitted, dragIndex, items.length, onMoved, onReorder]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  return {
    dragIndex,
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  };
}
