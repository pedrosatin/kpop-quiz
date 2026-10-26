import { test, expect, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function longFeedbackFixture(page: Page, locale: string) {
  const data = join(import.meta.dirname, "../public/data");
  const manifest = JSON.parse(readFileSync(join(data, "manifest-v2.json"), "utf8"));
  const key = `${locale === "pt-br" ? "pt-BR" : "en"}.standard`;
  const entry = manifest.sessions[key];
  const session = JSON.parse(readFileSync(join(data, entry.path), "utf8"));
  const question = session.questions[0];
  // Deliberately synthetic text stresses wrapping; no published data changes.
  for (const option of question.options) option.label += " layout test text".repeat(12);
  question.explanation += " Long explanation for scrolling verification.".repeat(40);
  const body = JSON.stringify(session);
  const hash = createHash("sha256").update(body).digest("hex");
  const path = `session.${key}.${hash}.json`;
  manifest.sessions[key] = { ...entry, path, sha256: hash };
  await page.route("**/data/manifest-v2.json", (route) => route.fulfill({ json: manifest }));
  await page.route(`**/data/${path}`, (route) => route.fulfill({ body, contentType: "application/json" }));
  return question.options.find((option: { id: string }) => option.id !== question.answer_option_id).id as string;
}

// playwright.quiz-layout.config.ts builds with PUBLIC_GA4_ID=G-QUIZ03TEST.
// No analytics request may leave the isolated browser context.
async function unobscured(page: Page, target: Locator) {
  const geometry = await target.evaluate((element) => {
    return [...element.getClientRects()].map((rect) => {
      const points = [[rect.x + 2, rect.y + 2], [rect.right - 2, rect.y + 2],
        [rect.x + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2],
        [rect.x + rect.width / 2, rect.y + rect.height / 2]];
      const hit = points.every(([x, y]) => {
        const target = document.elementFromPoint(x!, y!);
        return !!target && element.contains(target);
      });
      return { top: rect.top, bottom: rect.bottom, hit };
    });
  });
  expect(geometry.length).toBeGreaterThan(0);
  for (const rect of geometry) {
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(rect.hit).toBe(true);
  }
}

async function readEveryAnswerLine(page: Page) {
  const question = page.locator(".quiz-question-card");
  await question.hover();
  await page.mouse.wheel(0, -10_000);
  await expect.poll(() => question.evaluate((element) => element.scrollTop)).toBe(0);
  const seen = new Set<string>();
  let total = 0;
  for (let step = 0; step < 100; step += 1) {
    const lines = await question.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      return [...element.querySelectorAll(".option")].flatMap((option, optionIndex) => {
        const range = document.createRange();
        range.selectNodeContents(option.lastElementChild!);
        return [...range.getClientRects()].map((rect, lineIndex) => {
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { key: `${optionIndex}-${lineIndex}`, visible: rect.top >= viewport.top && rect.bottom <= viewport.bottom && !!hit && option.contains(hit) };
        });
      });
    });
    total = lines.length;
    for (const line of lines) if (line.visible) seen.add(line.key);
    if (seen.size === total) break;
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(40);
  }
  expect(total).toBeGreaterThanOrEqual(4);
  expect(seen.size, "each line of every answer can be read after answering").toBe(total);
}

for (const locale of ["pt-br", "en"]) {
  test(`${locale} timeout keeps feedback and actions reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto(`/${locale}/`);
    await expect(page.locator(".consent-banner")).toBeVisible();
    await page.getByRole("checkbox", { name: /Limitar cada pergunta|Limit each question/ }).check();
    await page.getByTestId("game-start").click();
    await expect(page.locator(".quiz-verdict")).toContainText(/Acabou o tempo|Time's up/, { timeout: 25_000 });
    const next = page.getByRole("button", { name: /Próxima pergunta|Next question/ });
    await expect(next).toBeFocused();
    await unobscured(page, next);
    await unobscured(page, page.locator(".quiz-verdict"));
    await page.waitForTimeout(500);
    await next.press("Enter");
    await expect(page.locator("#question-heading")).toBeFocused();
  });
  for (const width of [360, 390, 1280]) {
    for (const consent of ["open", "rejected"]) {
      for (const long of [false, true]) {
        test(`${locale} ${width} consent ${consent} long ${long}: options, feedback and fixed actions`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
          await page.route("**/*", (route) => {
            const url = new URL(route.request().url());
            return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
          });
          const wrongId = long ? await longFeedbackFixture(page, locale) : null;
          await page.goto(`/${locale}/`);
          const banner = page.locator(".consent-banner");
          await expect(banner, "build with the fictitious GA4 ID to exercise real consent").toBeVisible();
          if (consent === "rejected") {
            await banner.getByRole("button", { name: /Recusar|Reject/ }).click();
            await expect(banner).toBeHidden();
          }
          const start = page.getByTestId("game-start");
          await expect(start).toBeEnabled();
          await start.click();
          const board = page.getByTestId("game-board");
          await expect(board).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath("question.png") });
          const question = page.locator(".quiz-question-card");
          const actions = page.locator(".quiz-actions");
          const questionBox = await question.boundingBox();
          const actionBox = await actions.boundingBox();
          if (width < 960) {
            expect(questionBox!.y + questionBox!.height, "question scrollport stays above actions").toBeLessThanOrEqual(actionBox!.y);
          } else if (questionBox!.y + questionBox!.height > actionBox!.y) {
            // Desktop keeps page scrolling, rather than the mobile scrollport.
            await page.mouse.move(width - 4, 400);
            await page.mouse.wheel(0, questionBox!.y + questionBox!.height - actionBox!.y + 32);
          }
          for (const option of await page.locator(".option").all()) {
            await option.scrollIntoViewIfNeeded();
            await unobscured(page, option);
            if (width < 960) await option.tap();
            else await option.click();
            await expect(option.getByRole("radio")).toBeChecked();
          }
          if (wrongId) {
            const wrong = page.locator(`.option:has(input[value="${wrongId}"])`);
            await wrong.scrollIntoViewIfNeeded();
            await wrong.click();
          } else {
            await page.locator(".option").first().click();
            await page.keyboard.press("ArrowDown");
            await expect(page.getByRole("radio").nth(1)).toBeFocused();
            await expect(page.getByRole("radio").nth(1)).toBeChecked();
            await unobscured(page, page.locator(".option").nth(1));
          }
          await page.getByRole("button", { name: /^(Responder|Submit answer)$/ }).click();
          const next = page.getByRole("button", { name: /Próxima pergunta|Next question/ });
          await expect(next).toBeFocused();
          await unobscured(page, next);
          for (const button of await actions.getByRole("button").all()) await unobscured(page, button);
          if (width < 960) {
            const box = await question.boundingBox();
            expect(box!.y + box!.height).toBeLessThanOrEqual((await actions.boundingBox())!.y);
            await readEveryAnswerLine(page);
          }
          if (long && width < 960) {
            const message = actions.getByRole("status");
            expect(await message.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
            await message.hover();
            await page.mouse.wheel(0, 1000);
            await expect.poll(() => message.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
            expect(await message.evaluate((element) => {
              const text = element.querySelector("strong:last-child")!.lastChild!;
              const range = document.createRange();
              range.setStart(text, text.textContent!.length - 1);
              range.setEnd(text, text.textContent!.length);
              const rect = range.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              return !!hit && element.contains(hit);
            })).toBe(true);
          }
          await page.getByRole("button", { name: /^(Ver fonte|Show source)$/ }).click();
          const source = page.locator(".quiz-source");
          await expect(source).toBeVisible();
          if (width < 960) {
            const box = await question.boundingBox();
            expect(box!.y + box!.height).toBeLessThanOrEqual((await actions.boundingBox())!.y);
          }
          for (const button of await actions.getByRole("button").all()) await unobscured(page, button);
          if (consent === "open") {
            for (const button of await actions.getByRole("button").all()) {
              const box = await button.boundingBox();
              expect(box!.y + box!.height).toBeLessThanOrEqual((await banner.boundingBox())!.y);
            }
          }
          for (const link of await source.getByRole("link").all()) {
            await link.scrollIntoViewIfNeeded();
            await unobscured(page, link);
          }
          if (width < 960) await readEveryAnswerLine(page);
          await page.screenshot({ path: testInfo.outputPath("feedback-source.png") });
          await page.getByRole("button", { name: /Ocultar fonte|Hide source/ }).click();
          await page.waitForTimeout(500);
          await next.press("Enter");
          await expect(page.locator("#question-heading")).toBeFocused();
          await expect(page.locator(".options input:checked")).toHaveCount(0);
          if (!long) {
            for (let index = 1; index < 10; index += 1) {
              const option = page.locator(".option").last();
              await option.scrollIntoViewIfNeeded();
              await option.click();
              await page.getByRole("button", { name: /^(Responder|Submit answer)$/ }).click();
              await page.waitForTimeout(500);
              await page.getByRole("button", { name: /Próxima pergunta|Next question|Ver resultado|See results/ }).press("Enter");
            }
            await expect(page.getByTestId("game-result")).toBeVisible();
            await page.evaluate(() => {
              Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
              Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.copiedResult = text; } } });
            });
            await page.getByRole("button", { name: /^(Copiar resultado|Copy result)$/ }).click();
            expect(await page.locator("html").getAttribute("data-copied-result")).toContain("K-pop Quiz");
            await page.getByRole("button", { name: /Jogar novamente|Play again/ }).click();
            await expect(page.locator("#question-heading")).toBeFocused();
            await page.goto(`/${locale}/${locale === "pt-br" ? "privacidade" : "privacy"}/`);
            await page.goBack();
            await expect(page.getByTestId("game-setup").or(page.getByTestId("game-board"))).toBeVisible();
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
          expect(await page.evaluate(() => localStorage.getItem("kpop-quiz-consent"))).toBe(consent === "open" ? null : "rejected");
        });
      }
    }
  }
}
