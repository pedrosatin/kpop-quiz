import { useEffect, useRef, useState } from "preact/hooks";

export interface UseQuizTimerOptions {
  active: boolean;
  initialSeconds: number | null;
  onExpire: () => void;
}

export function useQuizTimer({ active, initialSeconds, onExpire }: UseQuizTimerOptions) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (!active || initialSeconds === null) return;
    if (secondsLeft <= 0) {
      onExpireRef.current();
      return;
    }
    timerRef.current = window.setTimeout(() => setSecondsLeft((val) => val - 1), 1000);
    return stopTimer;
  }, [active, initialSeconds, secondsLeft]);

  return { secondsLeft, setSecondsLeft, stopTimer };
}
