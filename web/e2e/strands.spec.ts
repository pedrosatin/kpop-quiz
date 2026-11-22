import { test, expect } from "./fixtures/consent";
import { fixedStrands, serveFixedStrands } from "./helpers/fixed-daily";
import { StrandsPage } from "./pages/strands.page";

test.describe("strands playthrough", () => {
  test("finds words by drag and by tap+Confirm, finds the spangram, finishes and shares", async ({
    page,
    baseURL,
  }) => {
    const puzzle = await serveFixedStrands(page);
    const strands = new StrandsPage(page, baseURL!);
    await strands.open({ served: true });

    const spangram = puzzle.words.find((word) => word.is_spangram)!;
    const members = puzzle.words.filter((word) => !word.is_spangram);
    const dragWord = members[0]!;
    const tapWord = members[1]!;

    await strands.findByDrag(dragWord);
    await strands.expectFoundCount(1);

    await strands.findByTapConfirm(tapWord);
    await strands.expectFoundCount(2);

    await strands.findByDrag(spangram);
    await strands.expectSpangramFound();
    await strands.expectFoundCount(3);

    for (const word of members.slice(2)) {
      await strands.findByDrag(word);
    }

    await strands.expectResult();
    await expect(page.getByTestId("found-counter")).toHaveCount(0);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    await page.getByRole("button", { name: /Compartilhar resultado|Share result/ }).click();
    const shareField = page.locator(".word-search-result textarea, .strands-result textarea").first();
    await expect(shareField).toBeVisible();
    const shareText = await shareField.inputValue();
    expect(shareText).toMatch(/Palavras conectadas|Strands/);
    expect(shareText).toContain(`${puzzle.words.length}/${puzzle.words.length}`);
    expect(shareText).toMatch(/palavras-conectadas\/\?s=strands|strands\/\?s=strands/);
  });

  test("frozen fixture is the Girls' Generation board of the fixed day", () => {
    expect(fixedStrands.reference_date).toBe("2026-09-17");
    expect(fixedStrands.theme["pt-BR"]).toMatch(/Girls' Generation/);
    expect(fixedStrands.words.some((word) => word.is_spangram && word.word === "GIRLSGENERATION")).toBe(
      true,
    );
  });
});
