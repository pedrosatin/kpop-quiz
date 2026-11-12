import type { LetterStatus, NameGuessTranslations } from "./types";

interface VirtualKeyboardProps {
  keyStatuses: Record<string, LetterStatus>;
  onChar: (char: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
  t: NameGuessTranslations;
}

const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];

export function VirtualKeyboard({
  keyStatuses,
  onChar,
  onEnter,
  onBackspace,
  t,
}: VirtualKeyboardProps) {
  // Enter on a focused letter key sends the guess, as on a physical keyboard;
  // left to the browser it would press the key and type its letter again.
  // Space and clicks still type the letter, and ENTER and DEL keep Enter.
  function submitOnEnter(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    onEnter();
  }

  function handleKeyClick(key: string) {
    if (key === "ENTER") {
      onEnter();
    } else if (key === "BACKSPACE") {
      onBackspace();
    } else {
      onChar(key);
    }
  }

  return (
    <div
      role="group"
      aria-label={t.keyboardAria}
      class="virtual-keyboard"
    >
      {KEYBOARD_ROWS.map((row, rIdx) => (
        <div key={rIdx} class="keyboard-row">
          {row.map((key) => {
            const isSpecial = key === "ENTER" || key === "BACKSPACE";
            const label =
              key === "ENTER" ? t.enter : key === "BACKSPACE" ? t.backspace : key;
            const status = keyStatuses[key];
            const statusClass = status ? `key-${status}` : "";
            const actionClass = isSpecial ? "key-action" : "";

            return (
              <button
                key={key}
                type="button"
                // A click or tap leaves focus where it was. Otherwise the key keeps focus
                // and a later physical Enter presses it again instead of submitting.
                // Tab still focuses the keys for keyboard users.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleKeyClick(key)}
                onKeyDown={isSpecial ? undefined : submitOnEnter}
                aria-label={label}
                class={`keyboard-key ${actionClass} ${statusClass}`.trim()}
                data-key={key}
                data-status={status || undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
