import { test as base, expect } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../../src/components/Consent/ConsentBanner";

/** Seeds GA4 consent so the banner never blocks smoke asserts. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, "rejected");
    }, CONSENT_STORAGE_KEY);
    await use(page);
  },
});

export { expect };
