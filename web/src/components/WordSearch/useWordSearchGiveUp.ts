import { useCallback, useRef, useState } from "preact/hooks";

/**
 * The give-up confirmation. The ref answers a confirm that arrives in the
 * same tick as the close, before the dialog re-renders shut, so a double
 * click gives up once.
 */
export function useWordSearchGiveUp(giveUp: () => void) {
  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const confirmGiveUpOpenRef = useRef(false);

  const closeGiveUpConfirm = useCallback(() => {
    confirmGiveUpOpenRef.current = false;
    setConfirmGiveUpOpen(false);
  }, []);

  const requestGiveUp = useCallback(() => {
    confirmGiveUpOpenRef.current = true;
    setConfirmGiveUpOpen(true);
  }, []);

  const confirmGiveUp = useCallback(() => {
    if (!confirmGiveUpOpenRef.current) return;
    closeGiveUpConfirm();
    giveUp();
  }, [closeGiveUpConfirm, giveUp]);

  return { confirmGiveUpOpen, requestGiveUp, confirmGiveUp, closeGiveUpConfirm };
}
