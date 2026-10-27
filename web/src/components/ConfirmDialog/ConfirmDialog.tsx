import { useId, useLayoutEffect, useRef } from "preact/hooks";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Safer default: focus Cancel so Enter does not confirm by accident. */
  initialFocus?: "cancel" | "confirm";
}

function trapTabFocus(e: KeyboardEvent, modal: HTMLDivElement | null) {
  if (e.key !== "Tab" || !modal) return;
  const focusableElements = modal.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusableElements.length === 0) return;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  if (e.shiftKey && document.activeElement === firstElement) {
    e.preventDefault();
    lastElement?.focus();
  } else if (!e.shiftKey && document.activeElement === lastElement) {
    e.preventDefault();
    firstElement?.focus();
  }
}

export function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  initialFocus = "cancel",
}: ConfirmDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const confirmedRef = useRef(false);
  // Per-instance ids so multiple ConfirmDialog mounts do not collide.
  const titleId = useId();
  const bodyId = useId();

  useLayoutEffect(() => {
    if (!isOpen) {
      confirmedRef.current = false;
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      (initialFocus === "confirm" ? confirmBtnRef : cancelBtnRef).current?.focus();
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      trapTabFocus(e, modalRef.current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onCancel, initialFocus]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        class="modal-card confirm-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        ref={modalRef}
      >
        <header class="modal-header">
          <h2 id={titleId} class="modal-title">
            {title}
          </h2>
        </header>
        <div class="modal-body">
          <p id={bodyId}>{body}</p>
        </div>
        <div class="modal-actions btn-row">
          <button
            type="button"
            class="btn btn-secondary"
            ref={cancelBtnRef}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            ref={confirmBtnRef}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
