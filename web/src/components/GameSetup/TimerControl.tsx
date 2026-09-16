export interface TimerControlProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function TimerControl({
  enabled,
  onChange,
  label,
  disabled = false,
}: TimerControlProps) {
  return (
    <label class="timer-choice">
      <input
        type="checkbox"
        checked={enabled}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
