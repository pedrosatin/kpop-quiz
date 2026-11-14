import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import type { PlayMode, QuizQuestion, QuizSession } from "../src/lib/quiz-types";
import { expect, test } from "./fixtures/consent-build";
import { skipUnlessPublished } from "./helpers/published";

/**
 * Two promises of the Quiz screen, measured in the browser:
 * - answering does not move the options (contract rule 4), with and without
 *   a clue above them;
 * - a first visit opens on today's challenge with Start above the fold, with
 *   the consent banner open and after it is refused.
 * The consent build is used for both, so the banner is the real one.
 */

const dataDir = fileURLToPath(new URL("../public/data/", import.meta.url));

type Box = { x: number; y: number; width: number; height: number };

async function optionBoxes(options: Locator): Promise<Box[]> {
  return options.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
}

/**
 * Publishes a general-quiz session whose first question has, or lacks, a
 * clue. The question with a clue is a real published one, so its evidence is
 * genuine; only the session and manifest hashes are recomputed. Nothing in
 * public/data changes.
 */
async function firstQuestionFixture(page: Page, mode: PlayMode, withClue: boolean) {
  const manifest = JSON.parse(readFileSync(join(dataDir, "manifest-v2.json"), "utf8"));
  const key = `pt-BR.${mode}`;
  const entry = manifest.sessions[key];
  const session = JSON.parse(readFileSync(join(dataDir, entry.path), "utf8")) as QuizSession;
  const taken = new Set(session.questions.map((question) => question.id));
  let replacement: QuizQuestion | undefined;
  if (withClue) {
    for (const name of readdirSync(dataDir).filter((file) => file.startsWith(`session.daily.pt-BR.${mode}.`)).sort()) {
      const other = JSON.parse(readFileSync(join(dataDir, name), "utf8")) as QuizSession;
      replacement = other.questions.find((question) => question.clues_available.length > 0 && !taken.has(question.id));
      if (replacement) break;
    }
    expect(replacement, `a published ${mode} question with a clue`).toBeDefined();
  } else {
    replacement = { ...session.questions[0]!, clues_available: [], clues_shown: [] };
  }
  session.questions[0] = replacement!;
  const body = JSON.stringify(session);
  const hash = createHash("sha256").update(body).digest("hex");
  const path = `session.${key}.${hash}.json`;
  manifest.sessions[key] = { ...entry, path, sha256: hash };
  await page.route("**/data/manifest-v3.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/data/catalog-manifest-v1.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/data/manifest-v2.json", (route) => route.fulfill({ json: manifest }));
  await page.route(`**/data/${path}`, (route) => route.fulfill({ body, contentType: "application/json" }));
  return replacement!;
}

async function refuseConsentBeforeLoad(page: Page) {
  await page.addInitScript((storageKey) => window.localStorage.setItem(storageKey, "rejected"), CONSENT_STORAGE_KEY);
}

const shiftViewports = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

const shiftScenarios = [
  { name: "today's challenge as published", query: "", mode: "standard", clue: null },
  { name: "standard without a clue", query: "?theme=history&mode=standard", mode: "standard", clue: false },
  { name: "standard with a closed clue", query: "?theme=history&mode=standard", mode: "standard", clue: true },
  { name: "assisted with the clue shown", query: "?theme=history&mode=assisted", mode: "assisted", clue: true },
] as const;

for (const viewport of shiftViewports) {
  for (const scenario of shiftScenarios) {
    test(`answering keeps the options in place (${viewport.width}x${viewport.height}, ${scenario.name})`, async ({ page, consentURL }) => {
      // A day may go out without the quiz (helpers/published.ts).
      await skipUnlessPublished(page, consentURL, "manifest-v2.json");
      await page.setViewportSize(viewport);
      await refuseConsentBeforeLoad(page);
      const question = scenario.clue === null ? null : await firstQuestionFixture(page, scenario.mode, scenario.clue);
      await page.goto(`${consentURL}/pt-br/${scenario.query}`);
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId("game-start").click();
      const board = page.getByTestId("game-board");
      await expect(board).toBeVisible();
      if (question) {
        await expect(board.getByRole("heading", { level: 2 })).toHaveText(question.prompt);
        if (!scenario.clue) await expect(page.getByTestId("quiz-no-clue")).toHaveText("Sem pista nesta pergunta.");
        else if (scenario.mode === "assisted") await expect(board.getByText(question.clues_available[0]!.text)).toBeVisible();
        else await expect(board.getByRole("button", { name: /^Ver pista/ })).toBeEnabled();
      }

      const options = board.locator("label.option");
      await expect(options).toHaveCount(4);
      // Pick with the keyboard, so no click scrolls the question area first.
      await board.getByRole("radio").first().focus();
      await page.keyboard.press("Space");
      await expect(board.getByRole("radio").first()).toBeChecked();
      const before = await optionBoxes(options);

      await board.getByRole("button", { name: "Responder" }).click();
      await expect(board.getByRole("button", { name: /Próxima pergunta|Ver resultado/ })).toBeFocused();
      const after = await optionBoxes(options);

      for (const [index, box] of before.entries()) {
        const moved = after[index]!;
        expect(Math.abs(moved.y - box.y), `option ${index + 1} moved vertically`).toBeLessThanOrEqual(4);
        expect(Math.abs(moved.x - box.x), `option ${index + 1} moved sideways`).toBeLessThanOrEqual(1);
        expect(Math.abs(moved.width - box.width), `option ${index + 1} changed width`).toBeLessThanOrEqual(1);
        expect(Math.abs(moved.height - box.height), `option ${index + 1} changed height`).toBeLessThanOrEqual(1);
      }
      if (scenario.clue === false) await expect(page.getByTestId("quiz-no-clue")).toHaveText("Sem pista nesta pergunta.");
    });
  }
}

const locales = [
  { id: "pt", path: "/pt-br/", daily: /^Quiz do dia/, general: /^Quiz geral/, customize: /^Personalizar/, expert: /^Especialista/, reject: /^Recusar Google Analytics$/ },
  { id: "en", path: "/en/", daily: /^Daily quiz/, general: /^General quiz/, customize: /^Customize/, expert: /^Expert/, reject: /^Reject Google Analytics$/ },
] as const;

/** Start is on screen, not under the banner or anything else, without scrolling. */
async function expectAboveTheFold(page: Page, target: Locator, banner: Locator | null) {
  expect(await page.evaluate(() => window.scrollY), "the page has not scrolled").toBe(0);
  const box = (await target.boundingBox())!;
  const fold = banner ? (await banner.boundingBox())!.y : page.viewportSize()!.height;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "Start ends above the fold").toBeLessThanOrEqual(fold);
  const covered = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !(hit && (hit === element || element.contains(hit)));
  });
  expect(covered, "nothing covers Start").toBe(false);
}

for (const locale of locales) {
  for (const consent of ["open", "rejected"] as const) {
    test(`first visit opens today's challenge with Start above the fold (${locale.id}, 360x740, banner ${consent})`, async ({ page, consentURL }) => {
      // A day may go out without the quiz (helpers/published.ts).
      await skipUnlessPublished(page, consentURL, "manifest-v2.json");
      await page.setViewportSize({ width: 360, height: 740 });
      if (consent === "rejected") await refuseConsentBeforeLoad(page);
      const sessions: string[] = [];
      page.on("request", (request) => {
        const name = new URL(request.url()).pathname.split("/").pop()!;
        if (name.startsWith("session.") || name.startsWith("catalog")) sessions.push(name);
      });
      await page.goto(`${consentURL}${locale.path}`);
      const banner = page.locator(".consent-banner");
      if (consent === "open") {
        await expect(banner, "the consent build renders the real banner").toBeVisible();
        expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(130);
      } else {
        await expect(banner).toHaveCount(0);
      }

      const start = page.getByTestId("game-start");
      await expect(start).toBeEnabled({ timeout: 30_000 });
      await expect(page.getByRole("radio", { name: locale.daily })).toBeChecked();
      await expect(page.getByRole("radio", { name: locale.general })).not.toBeChecked();
      await expectAboveTheFold(page, start, consent === "open" ? banner : null);
      expect(sessions.some((name) => name.startsWith("session.daily.")), "today's session is the one loaded").toBe(true);
      expect(sessions.some((name) => name.startsWith("catalog")), "the general catalog is not read").toBe(false);

      // The mode, the timer and the decades wait under Customize, reachable by keyboard.
      const customize = page.locator("details.setup-customize");
      await expect(customize).not.toHaveAttribute("open", "");
      await customize.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(customize).toHaveAttribute("open", "");
      await expect(page.getByRole("radio", { name: locale.expert })).toBeVisible();
      await expect(page.getByRole("radio", { name: locale.daily })).toBeChecked();
      await page.keyboard.press("Enter");
      await expect(customize).not.toHaveAttribute("open", "");

      await start.click();
      await expect(page.getByTestId("game-board")).toBeVisible();
      if (consent === "open") {
        await banner.getByRole("button", { name: locale.reject }).click();
        await expect(banner).toHaveCount(0);
      }
    });
  }
}
