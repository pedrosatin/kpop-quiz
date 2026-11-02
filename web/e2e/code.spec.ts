import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { reloadPersisted } from "./helpers/passive-effects";

// The pilot artifact stays committed as the fixed example; the specs serve it
// as the day's artifact through route interception, so the secret is known.
const artifact = JSON.parse(readFileSync(new URL("../public/data/code-groups.pilot.json", import.meta.url), "utf8"));
const secret: [string,string,string,string] = artifact.secret;
const prefix = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const route = "/pt-br/codigo/";

async function open(page: Page, baseURL: string | undefined, path = route) {
  // The daily pipeline may publish without the group code file, so the
  // browser suite always plays against the known artifact instead of the
  // committed (absent) daily file.
  await page.route("**/data/code-groups.daily.json", (request) => request.fulfill({ json: artifact }));
  await page.route("**/data/next/code-groups.daily.json", (request) => request.fulfill({ status: 404, body: "missing" }));
  await page.goto(joinBaseUrl(baseURL!, prefix + path));
  await expect(page.locator("#code-groups")).toBeVisible();
}
async function choose(page: Page, guess: string[], keyboard = false) {
  const selects = page.locator(".code-slots select");
  for (let i = 0; i < 4; i++) {
    const select = selects.nth(i);
    if (!keyboard) await select.selectOption(guess[i]!);
    else {
      await select.focus();
      await select.press("Home");
      const index = artifact.symbols.findIndex((s: {qid: string}) => s.qid === guess[i]) + 1;
      for (let step = 0; step < index; step++) await select.press("ArrowDown");
      await select.press("Enter");
    }
  }
}

test("rejects input errors, returns aggregate displacement, then wins", async ({ page, baseURL }) => {
  await open(page,baseURL);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator(".game-nav-bar")).toBeVisible();
  const submit = page.getByRole("button",{name:"Enviar palpite"});
  await submit.click();
  await expect(page.getByRole("status")).toContainText("Escolha os quatro grupos");
  await expect(page.getByTestId("code-remaining")).toContainText("10");
  await choose(page,[secret[0],secret[0],secret[1],secret[2]]);
  await submit.click();
  await expect(page.getByRole("status")).toContainText("quatro grupos diferentes");
  await expect(page.getByTestId("code-remaining")).toContainText("10");
  await choose(page,[secret[1],secret[2],secret[3],secret[0]]);
  await submit.click();
  await expect(page.locator(".code-history li")).toHaveCount(1);
  await expect(page.locator(".code-history li")).toContainText("0 exatos · 4 deslocados");
  await expect(page.getByTestId("code-remaining")).toContainText("9");
  const unused: string[] = artifact.symbols.filter((s: {qid:string}) => !secret.includes(s.qid)).map((s: {qid:string}) => s.qid);
  await choose(page,[unused[0]!,unused[1]!,secret[0],secret[1]]);
  await submit.click();
  await expect(page.locator(".code-history li").nth(1)).toContainText("0 exatos · 2 deslocados");
  await choose(page,secret);
  await submit.click();
  await expect(page.locator(".game-result")).toContainText("Código descoberto!");
  await expect(submit).toBeDisabled();
  await expect(page.locator(".game-result a")).toHaveCount(6);
});

test("ten failed guesses reveal the code and lock input", async ({ page, baseURL }) => {
  await page.setViewportSize({width:360,height:740});
  await open(page,baseURL);
  await choose(page,[secret[1],secret[0],secret[2],secret[3]]);
  for (let i=0;i<10;i++) await page.getByRole("button",{name:"Enviar palpite"}).click();
  await expect(page.locator(".code-history li")).toHaveCount(10);
  await expect(page.locator(".game-result")).toContainText("Tentativas esgotadas");
  // The result reads the visible names: the Wikipedia note is hidden, the rest kept.
  const result = page.locator(".game-result");
  await expect(result).toContainText("Sequência secreta: Redsquare / Geenius / 1Verse / The Boyz");
  await expect(result).not.toContainText("South Korean band");
  await expect(page.getByRole("button",{name:"Enviar palpite"})).toBeDisabled();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test("progress resumes after a reload and does not replay stats", async ({ page, baseURL }) => {
  await open(page,baseURL);
  // A wrong first guess leaves the round open so reload can restore it.
  await choose(page,[secret[1],secret[0],secret[2],secret[3]]);
  await page.getByRole("button",{name:"Enviar palpite"}).click();
  await expect(page.locator(".code-history li")).toHaveCount(1);
  await reloadPersisted(page);
  await expect(page.locator("#code-groups")).toBeVisible();
  await expect(page.locator(".code-history li")).toHaveCount(1);
  await choose(page,secret);
  await page.getByRole("button",{name:"Enviar palpite"}).click();
  await expect(page.locator(".game-result")).toContainText("Código descoberto!");
});

test("a day without the artifact offers working retry", async ({page,baseURL}) => {
  await page.route("**/data/code-groups.daily.json",(request) => request.fulfill({status:404,body:"missing"}));
  await page.route("**/data/next/code-groups.daily.json",(request) => request.fulfill({status:404,body:"missing"}));
  await page.goto(joinBaseUrl(baseURL!,prefix + route));
  await expect(page.getByTestId("game-missing")).toContainText("ainda não foi publicado");
  await page.route("**/data/code-groups.daily.json",(request) => request.fulfill({json:artifact}));
  await page.getByTestId("game-retry").click();
  await expect(page.locator("#code-groups")).toBeVisible();
  await choose(page,secret);
  await page.getByRole("button",{name:"Enviar palpite"}).click();
  await expect(page.locator(".game-result")).toContainText("Código descoberto!");
});

test("English route and keyboard selection complete the same sample", async ({ page, baseURL }) => {
  await open(page,baseURL);
  await page.getByRole("link",{name:"English",exact:true}).click();
  await expect(page).toHaveURL(/\/en\/code\/$/);
  await expect(page.getByRole("heading",{name:"Group code",level:1})).toBeVisible();
  await choose(page,secret,true);
  await page.getByRole("button",{name:"Submit guess"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".game-result")).toContainText("Code solved!");
  await expect(page.locator(".game-result")).toBeFocused();
});

test("an invalid artifact is rejected even with a valid shape", async ({page,baseURL}) => {
  await page.route("**/data/code-groups.daily.json",(request) => request.fulfill({json:{...artifact,mode:"daily"}}));
  await page.goto(joinBaseUrl(baseURL!,prefix + route));
  await expect(page.getByTestId("game-missing")).toContainText("Não foi possível carregar");
});

test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 740 } });
  test("touch submission solves the code", async ({page,baseURL}) => {
    await open(page,baseURL);
    await choose(page,secret);
    await page.getByRole("button",{name:"Enviar palpite"}).tap();
    await expect(page.locator(".game-result")).toContainText("Código descoberto!");
    await expect(page.locator(".code-slots select").first()).toBeDisabled();
  });
});
