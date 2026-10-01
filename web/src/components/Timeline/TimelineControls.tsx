import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { TimelineControlsProps } from "./types";

export const TIMELINE_SUBMIT_GUARD_MS = 300;

export function TimelineControls({
  gameStatus = "in_progress",
  onSubmit,
  locale = "pt-BR",
  messages,
  disabled = false,
}: TimelineControlsProps) {
  const [clicked, setClicked] = useState(false);
  const lastClickRef = useRef<number>(0);

  useEffect(() => {
    if (gameStatus === "in_progress") {
      setClicked(false);
    }
  }, [gameStatus]);

  const isSubmitted = gameStatus === "submitted";
  const isDisabled = disabled || isSubmitted || clicked;

  const handleClick = useCallback(() => {
    if (isDisabled) return;
    const now = performance.now();
    if (now - lastClickRef.current < TIMELINE_SUBMIT_GUARD_MS) {
      return;
    }
    lastClickRef.current = now;
    setClicked(true);
    onSubmit();
  }, [isDisabled, onSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.repeat) {
      e.preventDefault();
    }
  }, []);

  const submitLabel =
    messages?.submit ?? (locale === "en" ? "Check order" : "Verificar ordem");

  return (
    <div class="timeline-controls game-actions">
      <button
        type="button"
        class="btn btn-primary timeline-btn-submit"
        disabled={isDisabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {submitLabel}
      </button>
    </div>
  );
}
