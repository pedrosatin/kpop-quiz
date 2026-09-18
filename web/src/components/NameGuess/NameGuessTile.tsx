import type { TileStatus } from "./types";

interface NameGuessTileProps {
  letter: string;
  status: TileStatus;
  highContrast: boolean;
  position: number;
}

export function NameGuessTile({
  letter,
  status,
  highContrast,
  position,
}: NameGuessTileProps) {
  let bgClass = "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white";
  let statusText = "vazio";

  if (status === "active") {
    bgClass = "bg-white dark:bg-slate-900 border-slate-600 dark:border-slate-400 text-slate-900 dark:text-white font-bold scale-105";
    statusText = `letra ${letter}`;
  } else if (status === "correct") {
    if (highContrast) {
      bgClass = "bg-blue-700 border-blue-800 text-white font-bold";
    } else {
      bgClass = "bg-green-700 border-green-800 text-white font-bold";
    }
    statusText = `letra ${letter}, correta`;
  } else if (status === "present") {
    if (highContrast) {
      bgClass = "bg-orange-600 border-orange-700 text-white font-bold";
    } else {
      bgClass = "bg-amber-500 border-amber-600 text-slate-950 font-bold";
    }
    statusText = `letra ${letter}, posição diferente`;
  } else if (status === "absent") {
    bgClass = "bg-slate-500 border-slate-600 text-white font-bold";
    statusText = `letra ${letter}, não faz parte`;
  }

  return (
    <div
      role="status"
      aria-label={`Posição ${position + 1}: ${statusText}`}
      class={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 flex items-center justify-center text-xl sm:text-2xl font-black rounded-md border-2 transition-all duration-200 uppercase select-none ${bgClass}`}
    >
      {letter}
    </div>
  );
}
