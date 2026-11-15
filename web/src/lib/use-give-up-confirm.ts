import { useCallback, useRef, useState } from "preact/hooks";

/** The give-up confirmation a game wires to its `ConfirmDialog`. */
export interface GiveUpConfirm {
  confirmGiveUpOpen: boolean;
  /** Opens the dialog. */
  requestGiveUp: () => void;
  /** Shuts the dialog and keeps the round: Cancel, Escape, a timeout or a new round. */
  closeGiveUpConfirm: () => void;
  /**
   * Shuts the dialog, then runs the game's `giveUp`. With the dialog already
   * shut it does nothing, so a confirm in the same tick as a close, or a
   * second confirm, ends the round at most once.
   */
  confirmGiveUp: (giveUp: () => void) => void;
}

/**
 * The open state of the give-up confirmation. The ref answers a confirm that
 * arrives in the same tick as a close, before the dialog renders shut. The
 * dialog shuts before `giveUp` runs, so a `giveUp` that confirms again finds
 * it shut.
 */
export function useGiveUpConfirm(): GiveUpConfirm {
  const [confirmGiveUpOpen, setConfirmGiveUpOpen] = useState(false);
  const openRef = useRef(false);

  const closeGiveUpConfirm = useCallback(() => {
    openRef.current = false;
    setConfirmGiveUpOpen(false);
  }, []);

  const requestGiveUp = useCallback(() => {
    openRef.current = true;
    setConfirmGiveUpOpen(true);
  }, []);

  const confirmGiveUp = useCallback((giveUp: () => void) => {
    if (!openRef.current) return;
    closeGiveUpConfirm();
    giveUp();
  }, [closeGiveUpConfirm]);

  return { confirmGiveUpOpen, requestGiveUp, closeGiveUpConfirm, confirmGiveUp };
}
