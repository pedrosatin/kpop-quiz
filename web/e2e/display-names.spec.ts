import { test, expect } from "./fixtures/consent";
import { ConnectionsPage } from "./pages/connections.page";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { expectBoardDirectReady } from "./helpers/boot";
import { NameGuessPage } from "./pages/name-guess.page";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

// Visible names on the Connections board, per locale and viewport, and again
// after a reload (the board is rebuilt from the artifact, not from memory).
for (const viewport of VIEWPORTS) {
  test(`pt connections ${viewport.name}: tiles show the visible names, also after reload`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const connections = new ConnectionsPage(page, baseURL!);
    await connections.open();
    await connections.expectVisibleNames("pt-BR");
    await page.reload();
    await expectBoardDirectReady(page);
    await connections.expectVisibleNames("pt-BR");
  });

  test(`en connections ${viewport.name}: tiles show the visible names`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(joinBaseUrl(baseURL!, "/en/connections/"));
    await expectBoardDirectReady(page);
    await new ConnectionsPage(page, baseURL!).expectVisibleNames("en");
  });
}

test("pt connections mobile: share text has the localized header and hides notes and answers after a reload", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  const connections = new ConnectionsPage(page, baseURL!);
  await connections.open();
  await connections.loseWithWrongGuesses();
  await page.reload();
  await expectBoardDirectReady(page);
  await connections.expectResult();
  // Result buttons ignore presses for a moment after they replace the controls.
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Compartilhar resultado" }).click();
  const text = await page.getByRole("textbox").inputValue();
  expect(text.split("\n")[0]).toMatch(/^Conexões de K-pop \d{4}-\d{2}-\d{2}$/);
  expect(text).toContain("utm_campaign=connections");
  expect(text).not.toContain("K-pop Connections");
  expect(text).not.toMatch(/\((grupo|banda|group|band)[^)]*\)/i);
});

// The 2026-10-26 board publishes the pt-BR label "shinee" (Q269836). Serving it
// as the day's artifact exercises the reviewed spelling in the real page, next
// to labels that must stay as published.
for (const viewport of VIEWPORTS) {
  test(`pt connections ${viewport.name}: the published shinee reads SHINee, f(x) and TXT stay as published`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route("**/data/next/connections.daily.json", (request) => request.fulfill({ status: 404, body: "missing" }));
    const connections = new ConnectionsPage(page, baseURL!);
    await connections.open();
    const board = page.getByTestId("game-board");
    await expect(board.getByRole("button", { name: /^SHINee,/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^shinee,/ })).toHaveCount(0);
    await expect(board.getByRole("button", { name: /^f\(x\),/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^TXT,/ })).toBeVisible();
  });
}

// Name Guess shows one target, so its answer keeps the label as published.
for (const viewport of VIEWPORTS) {
  test(`pt name guess ${viewport.name}: the revealed answer is the published label, also after reload`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const nameGuess = new NameGuessPage(page, baseURL!);
    await nameGuess.open();
    await nameGuess.loseWithWrongGuesses();
    await nameGuess.expectRevealedLabel("pt-BR");
    await page.reload();
    await expectBoardDirectReady(page);
    await nameGuess.expectRevealedLabel("pt-BR");
  });
}
