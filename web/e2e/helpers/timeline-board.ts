import type { Page } from "@playwright/test";

const DRAFT_KEY_PREFIX = "kpop-timeline-";

/** The event ids of the Timeline cards, in the order on screen. */
export function cardIds(page: Page): Promise<string[]> {
  return page
    .locator(".timeline-card")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-testid")!.replace("timeline-card-", "")));
}

/** The board order saved as the draft, or null before the first move. */
export function savedOrder(page: Page): Promise<string[] | null> {
  return page.evaluate((prefix) => {
    const key = Object.keys(localStorage).find((name) => name.startsWith(prefix));
    const saved = key ? localStorage.getItem(key) : null;
    return saved ? (JSON.parse(saved).orderedEventIds as string[]) : null;
  }, DRAFT_KEY_PREFIX);
}
