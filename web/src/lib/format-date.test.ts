import { describe, expect, it } from "vitest";
import { formatCalendarDate } from "./format-date";

describe("formatCalendarDate", () => {
  it("writes the month by name in each language", () => {
    expect(formatCalendarDate("2026-11-07", "pt-BR")).toBe("7 de nov. de 2026");
    expect(formatCalendarDate("2026-11-07", "en")).toBe("Nov 7, 2026");
  });

  it("does not shift the day with the device time zone", () => {
    expect(formatCalendarDate("2026-01-01", "en")).toBe("Jan 1, 2026");
  });
});
