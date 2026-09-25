import type { MistakesRemainingProps } from "./types";

export function MistakesRemaining({
  mistakesRemaining,
  maxMistakes = 4,
  messages,
}: MistakesRemainingProps) {
  const dots = Array.from({ length: maxMistakes }, (_, i) => i < mistakesRemaining);
  const text = messages.connectionsMistakesRemaining(mistakesRemaining);

  return (
    <p class="hud-item mistakes-remaining" aria-live="polite">
      <span class="hud-label">{text}</span>
      <span class="mistakes-dots" aria-hidden="true">
        {dots.map((active, index) => (
          <span
            key={index}
            class={`mistake-dot ${active ? "active" : "used"}`}
          />
        ))}
      </span>
    </p>
  );
}
