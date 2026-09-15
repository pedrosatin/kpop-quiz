export interface QuizStateProps {
  label: string;
  busy?: boolean;
  action?: string;
  onAction?: () => void;
}

export function QuizState({
  label,
  busy = false,
  action,
  onAction,
}: QuizStateProps) {
  return (
    <section id="quiz" class="quiz-card state" aria-live="polite" aria-busy={busy}>
      {busy && <span class="loader" aria-hidden="true" />}
      <p>{label}</p>
      {action && (
        <button class="primary-action" type="button" onClick={onAction}>
          {action}
        </button>
      )}
    </section>
  );
}
