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
  let bgClass = "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white";
  let tileLabel = t.emptyTile(position + 1);

  if (status === "active") {
    bgClass = "bg-white dark:bg-slate-900 border-slate-600 dark:border-slate-400 text-slate-900 dark:text-white font-bold scale-105";
    tileLabel = t.activeTile(position + 1, letter);
  } else if (status === "correct") {
    if (highContrast) {
      bgClass = "bg-blue-700 border-blue-800 text-white font-bold";
    } else {
      bgClass = "bg-green-700 border-green-800 text-white font-bold";
    }
    tileLabel = t.correctTile(position + 1, letter);
  } else if (status === "present") {
    if (highContrast) {
      bgClass = "bg-orange-800 border-orange-900 text-white font-bold";
    } else {
      bgClass = "bg-amber-500 border-amber-600 text-slate-950 font-bold";
    }
    tileLabel = t.presentTile(position + 1, letter);
  } else if (status === "absent") {
    bgClass = "bg-slate-500 border-slate-600 text-white font-bold";
    tileLabel = t.absentTile(position + 1, letter);
  }

  return (
    <div
      role="img"
      aria-label={tileLabel}
      class={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 flex items-center justify-center text-xl sm:text-2xl font-black rounded-md border-2 transition-all duration-200 uppercase select-none ${bgClass}`}
    >
      {letter}
    </div>
  );
}
