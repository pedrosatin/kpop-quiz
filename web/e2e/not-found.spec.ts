import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";

test("unknown paths answer 404 with the not-found page", async ({ page, baseURL }) => {
  expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();
  const response = await page.goto(joinBaseUrl(baseURL!, "/nao-existe-xyz/"));
  expect(response, "navigation must return a response").not.toBeNull();
  expect(response!.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});
