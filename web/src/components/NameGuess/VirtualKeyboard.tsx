import type { LetterStatus, NameGuessTranslations } from "./types";

interface VirtualKeyboardProps {
  keyStatuses: Record<string, LetterStatus>;
  onChar: (char: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
  highContrast: boolean;
  t: NameGuessTranslations;
  disabled?: boolean;
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
  highContrast,
  t,
  disabled = false,
}: VirtualKeyboardProps) {
  function getKeyColor(key: string): string {
    const status = keyStatuses[key];
    if (!status) {
      return "bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600 active:bg-slate-400";
    }
    if (status === "correct") {
      return highContrast
        ? "bg-blue-700 text-white font-bold"
        : "bg-green-700 text-white font-bold";
    }
    if (status === "present") {
      return highContrast
        ? "bg-orange-800 text-white font-bold"
        : "bg-amber-500 text-slate-950 font-bold";
    }
    return "bg-slate-300 dark:bg-slate-800 text-slate-900 dark:text-slate-200";
  }

  function handleKeyClick(key: string) {
    if (disabled) return;
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
      class="w-full max-w-lg mx-auto p-1.5 sm:p-2 select-none"
    >
      {KEYBOARD_ROWS.map((row, rIdx) => (
        <div key={rIdx} class="flex justify-center gap-1 sm:gap-1.5 my-1">
          {row.map((key) => {
            const isSpecial = key === "ENTER" || key === "BACKSPACE";
            const label =
              key === "ENTER" ? t.enter : key === "BACKSPACE" ? t.backspace : key;
            const widthClass = isSpecial ? "px-2 sm:px-3 text-xs sm:text-sm" : "flex-1 text-sm sm:text-base";

            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => handleKeyClick(key)}
                aria-label={label}
                class={`h-11 sm:h-12 flex items-center justify-center font-bold rounded cursor-pointer transition-colors ${widthClass} ${getKeyColor(
                  key
                )} disabled:opacity-50 disabled:cursor-not-allowed`}
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
