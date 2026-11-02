import type { Page } from "@playwright/test";

export function gamePlayed(page: Page, game: string): Promise<number | undefined> {
  return page.evaluate((id) => JSON.parse(localStorage.getItem("kpop-player-stats-v1") ?? "{}").games?.[id]?.played, game);
}
