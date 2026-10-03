import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { dailyReferenceDate } from "../../src/data/daily-artifact";
import { joinBaseUrl } from "../../src/lib/join-base-url";

/**
 * Same resolution as preferNextDaily: use data/next/ when it is newer and
 * not past today (America/Sao_Paulo), otherwise the main data/ artifact.
 */
export async function loadPreferNextDaily<T extends { reference_date: string }>(
  request: APIRequestContext,
  baseURL: string,
  filename: string,
): Promise<T> {
  const mainUrl = joinBaseUrl(baseURL, `/data/${filename}`);
  const mainResponse = await request.get(mainUrl);
  expect(mainResponse.ok(), `expected OK for ${mainUrl}, got ${mainResponse.status()}`).toBeTruthy();
  const current = (await mainResponse.json()) as T;
  expect(typeof current.reference_date, `${filename} reference_date`).toBe("string");

  const today = dailyReferenceDate();
  if (current.reference_date >= today) return current;

  const nextUrl = joinBaseUrl(baseURL, `/data/next/${filename}`);
  try {
    const nextResponse = await request.get(nextUrl);
    if (!nextResponse.ok()) return current;
    const payload = (await nextResponse.json()) as T;
    if (
      typeof payload.reference_date === "string"
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
