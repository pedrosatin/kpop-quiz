export interface QuizStateProps {
  label?: string | undefined;
  message?: string | undefined;
  busy?: boolean | undefined;
  action?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  /** The quiz keeps the 64rem card in every state; other games keep 42rem. */
  wide?: boolean | undefined;
}

export function QuizState({
  label,
  message,
  busy = false,
  action,
  actionLabel,
  onAction,
  wide = false,
}: QuizStateProps) {
  const content = message ?? label;
  const buttonLabel = actionLabel ?? action;
  return (
    <section id="quiz" class={wide ? "game-card game-card--wide state" : "game-card state"} aria-live="polite" aria-busy={busy}>
      {busy && <span class="loader" aria-hidden="true" />}
      {content && <p>{content}</p>}
      {buttonLabel && (
        <button class="btn btn-primary" type="button" onClick={onAction}>
          {buttonLabel}
        </button>
      )}
    </section>
  );
}
