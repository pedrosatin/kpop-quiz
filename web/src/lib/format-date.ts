import type { Locale } from "./quiz-types";

/** A `YYYY-MM-DD` calendar date as "7 de nov. de 2026" or "Nov 7, 2026". */
export function formatCalendarDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
