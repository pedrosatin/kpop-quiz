import { useCallback, useState } from "preact/hooks";
import type { TimelineEvent } from "../../lib/timeline-types";

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
      const raw = e.dataTransfer?.getData("text/plain");
      const from = raw !== undefined && raw !== "" ? parseInt(raw, 10) : dragIndex;
      setDragIndex(null);
      setDragOverIndex(null);

      if (from === null || isNaN(from) || from === targetIndex || from < 0 || from >= items.length) {
        return;
      }

      if (targetIndex < 0 || targetIndex >= items.length || isNaN(targetIndex)) {
        return;
      }

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
