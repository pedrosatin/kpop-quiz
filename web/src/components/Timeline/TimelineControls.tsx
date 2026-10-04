import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { TimelineControlsProps } from "./types";

const TIMELINE_SUBMIT_GUARD_MS = 300;

export function TimelineControls({
  gameStatus = "in_progress",
  onSubmit,
  locale = "pt-BR",
  messages,
  disabled = false,
}: TimelineControlsProps) {
  const [clicked, setClicked] = useState(false);
  // performance.now() counts from navigation, so a 0 start would drop a first
  // click made in the page's first 300 ms. The guard only blocks repeats.
  const lastClickRef = useRef<number>(-Infinity);

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
