import { NameGuessTile } from "./NameGuessTile";
import type { LetterStatus, NameGuessTranslations, TileStatus } from "./types";

interface NameGuessRowProps {
  wordLength: number;
  guess?: string | undefined;
  feedback?: LetterStatus[] | undefined;
  isCurrent?: boolean | undefined;
  currentInput?: string | undefined;
  rowIndex: number;
  t: NameGuessTranslations;
}

export function NameGuessRow({
  wordLength,
  guess,
  feedback,
  isCurrent,
  currentInput = "",
  rowIndex,
  t,
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
        position={i}
        t={t}
      />
    );
  }

  return (
    <div
      role="group"
      aria-label={t.rowAria(rowIndex + 1)}
      class="name-guess-row"
    >
      {tiles}
    </div>
  );
}
