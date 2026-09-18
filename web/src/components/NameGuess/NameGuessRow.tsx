import { NameGuessTile } from "./NameGuessTile";
import type { LetterStatus, TileStatus } from "./types";

interface NameGuessRowProps {
  wordLength: number;
  guess?: string | undefined;
  feedback?: LetterStatus[] | undefined;
  isCurrent?: boolean | undefined;
  currentInput?: string | undefined;
  highContrast: boolean;
  rowIndex: number;
}

export function NameGuessRow({
  wordLength,
  guess,
  feedback,
  isCurrent,
  currentInput = "",
  highContrast,
  rowIndex,
}: NameGuessRowProps) {
  const tiles = [];

  for (let i = 0; i < wordLength; i++) {
    let letter = "";
    let status: TileStatus = "empty";

    if (guess && feedback) {
      letter = guess[i] || "";
      status = feedback[i] || "empty";
    } else if (isCurrent) {
      letter = currentInput[i] || "";
      status = letter ? "active" : "empty";
    }

    tiles.push(
      <NameGuessTile
        key={i}
        letter={letter}
        status={status}
        highContrast={highContrast}
        position={i}
      />
    );
  }

  return (
    <div
      role="group"
      aria-label={`Tentativa ${rowIndex + 1}`}
      class="flex justify-center gap-1.5 sm:gap-2 my-1"
    >
      {tiles}
    </div>
  );
}
