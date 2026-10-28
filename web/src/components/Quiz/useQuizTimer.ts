import { useEffect, useRef, useState } from "preact/hooks";

export interface UseQuizTimerOptions {
  active: boolean;
  /** Absolute wall-clock deadline; null when the timer is off or stopped. */
  deadlineMs: number | null;
  onExpire: () => void;
}

/**
 * Counts down from an absolute deadline so reload / background tabs keep the
 * original prazo. Expiration fires once per deadline value.
 */
export function useQuizTimer({ active, deadlineMs, onExpire }: UseQuizTimerOptions) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const expiredForDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || deadlineMs === null) {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && expiredForDeadlineRef.current !== deadlineMs) {
        expiredForDeadlineRef.current = deadlineMs;
        onExpireRef.current();
      }
    };

    tick();
    const timerId = window.setInterval(tick, 250);
    return () => window.clearInterval(timerId);
  }, [active, deadlineMs]);

  const stopTimer = () => {
    // Parent clears deadlineMs; this exists for call-site symmetry with Q03.
  };

  return { secondsLeft, stopTimer };
}
