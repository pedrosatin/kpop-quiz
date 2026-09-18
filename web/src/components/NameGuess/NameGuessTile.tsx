import type { NameGuessTranslations, TileStatus } from "./types";

interface NameGuessTileProps {
  letter: string;
  status: TileStatus;
  highContrast: boolean;
  position: number;
  t: NameGuessTranslations;
}

export function NameGuessTile({
  letter,
  status,
  highContrast,
  position,
  t,
}: NameGuessTileProps) {
  let tileLabel = t.emptyTile(position + 1);

  if (status === "active") {
    tileLabel = t.activeTile(position + 1, letter);
  } else if (status === "correct") {
    tileLabel = t.correctTile(position + 1, letter);
  } else if (status === "present") {
    tileLabel = t.presentTile(position + 1, letter);
  } else if (status === "absent") {
    tileLabel = t.absentTile(position + 1, letter);
  }

  const statusClass = `is-${status}`;
  const contrastClass = highContrast ? "high-contrast" : "";

  return (
    <div
      role="img"
      aria-label={tileLabel}
      class={`name-guess-cell ${statusClass} ${contrastClass}`.trim()}
      data-status={status}
      data-contrast={highContrast ? "high" : "normal"}
    >
      {letter}
    </div>
  );
}
