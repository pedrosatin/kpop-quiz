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

/**
 * Newer of the main artifact and its next/ copy, never past today.
 * Any failure to load or validate the next/ copy keeps the main artifact.
 */
export async function preferNextDaily<T extends { reference_date: string }>(
  current: T,
  filename: string,
  baseUrl: string,
  isValid: (value: unknown) => value is T,
  today: string = dailyReferenceDate(),
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
