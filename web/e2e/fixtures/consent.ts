import { test as base, expect } from "@playwright/test";

/** Seeds GA4 consent so the banner never blocks smoke asserts. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("kpop-quiz-consent", "rejected");
    });
    await use(page);
  },
});

export { expect };
