import type { MistakesRemainingProps } from "./types";

export function MistakesRemaining({
  mistakesRemaining,
  maxMistakes = 4,
  messages,
}: MistakesRemainingProps) {
  const dots = Array.from({ length: maxMistakes }, (_, i) => i < mistakesRemaining);
  const text = messages.connectionsMistakesRemaining(mistakesRemaining);

  return (
    <div class="mistakes-remaining" aria-live="polite">
      <span class="mistakes-label">{text}</span>
      <div class="mistakes-dots" aria-hidden="true">
        {dots.map((active, index) => (
          <span
            key={index}
            class={`mistake-dot ${active ? "active" : "used"}`}
          />
        ))}
      </div>
    </div>
  );
}
