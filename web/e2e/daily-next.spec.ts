import { test, expect } from "./fixtures/consent";
import { ConnectionsPage } from "./pages/connections.page";

// The end of a daily game: the countdown to the next challenge, the next
// game not finished today, and a ✓ on the finished game's tab.
for (const viewport of [{ width: 1280, height: 800 }, { width: 360, height: 800 }]) {
  test(`connections ends with the countdown and the next game (${viewport.width}px)`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const connections = new ConnectionsPage(page, baseURL!);
    await connections.open();
    await connections.loseWithWrongGuesses();
    await connections.expectResult();

    const result = page.getByTestId("game-result");
    await expect(result.getByRole("button", { name: "Jogar novamente" })).toHaveCount(0);
    const countdown = result.getByText(/^Novo desafio em \d{2}:\d{2}:\d{2}$/);
    await expect(countdown).toHaveAttribute("aria-live", "off");
    const shown = await countdown.textContent();
    await expect(countdown).not.toHaveText(shown!, { timeout: 3_000 });

    const next = result.getByRole("link", { name: "Próximo: Quiz" });
    await expect(next).toBeVisible();
    await expect(next).toHaveAttribute("href", /\/pt-br\/\?theme=daily$/);
    const tabs = page.getByRole("navigation", { name: "Jogos de K-pop" });
    await expect(tabs.getByRole("link", { name: "Conexões concluído hoje" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

    await next.click();
    await expect(page).toHaveURL(/\/pt-br\/\?theme=daily$/);
    await expect(page.getByRole("navigation", { name: "Jogos de K-pop" }).getByRole("link", { name: "Conexões concluído hoje" })).toBeVisible();
  });
}
