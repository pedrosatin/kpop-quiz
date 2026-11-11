// The daily workflow publishes each day's puzzles one day ahead under
// data/next/. The site switches to them at midnight in Sao Paulo, the time
// zone of the generator's reference date, even before the next run
// promotes them to data/.

const DAILY_TIME_ZONE = "America/Sao_Paulo";

export function dailyReferenceDate(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Seconds until the next daily challenge, the next midnight in Sao Paulo:
 * 86400 right at midnight, 1 at 23:59:59. Brazil has kept UTC-3 all year
 * since 2019, so every day has 24 hours.
 */
export function secondsUntilNextDaily(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DAILY_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return 86400 - (field("hour") * 3600 + field("minute") * 60 + field("second"));
}

export function nextDataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/next/${filename}`;
}

// Boards a loader served after their day, with that day: neither data/ nor
// data/next/ had today's challenge. Decided once, when the board is loaded,
// so a board loaded before midnight stays today's until the page reloads.
const staleBoards = new WeakMap<object, string>();

/**
 * Notes, when a loader serves `board`, whether its day is before `today`.
 * The single place that decides whether a daily board is today's.
 */
export function noteDailyBoard<T extends object>(
  board: T,
  referenceDate: string | null | undefined,
  today: string = dailyReferenceDate(),
): T {
  if (referenceDate && referenceDate < today) staleBoards.set(board, referenceDate);
  return board;
}

/**
 * The date of a board a loader served after its day; undefined for today's
 * board and for one that never went through a loader. Such a board is not
 * today's challenge: the game shows its date and counts no daily match.
 */
export function staleDailyDate(board: object | null | undefined): string | undefined {
  return board ? staleBoards.get(board) : undefined;
}

/**
 * Newer of the main artifact and its next/ copy, never past today, noted as
 * stale when neither is today's. Any failure to load or validate the next/
 * copy keeps the main artifact.
 */
export async function preferNextDaily<T extends { reference_date: string }>(
  current: T,
  filename: string,
  baseUrl: string,
  isValid: (value: unknown) => value is T,
  today: string = dailyReferenceDate(),
): Promise<T> {
  const board = await newerDaily(current, filename, baseUrl, isValid, today);
  return noteDailyBoard(board, board.reference_date, today);
}

async function newerDaily<T extends { reference_date: string }>(
  current: T,
  filename: string,
  baseUrl: string,
  isValid: (value: unknown) => value is T,
  today: string,
): Promise<T> {
  if (current.reference_date >= today) return current;
  try {
    const response = await fetch(nextDataUrl(filename, baseUrl));
    if (!response.ok) return current;
    const payload: unknown = await response.json();
    if (
      isValid(payload)
      && payload.reference_date > current.reference_date
      && payload.reference_date <= today
    ) {
      return payload;
    }
  } catch {
    // Keep the main artifact.
  }
  return current;
}
