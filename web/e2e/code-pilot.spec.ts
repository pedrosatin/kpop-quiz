import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { joinBaseUrl } from "../src/lib/join-base-url";

const artifact = JSON.parse(readFileSync(new URL("../public/data/code-groups.pilot.json", import.meta.url), "utf8"));
const secret: [string,string,string,string] = artifact.secret;
const prefix = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const route = "/pt-br/codigo-piloto/";
async function open(page: Page, baseURL: string | undefined, path = route) {
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

test("pilot rejects input errors, returns aggregate displacement, then wins", async ({ page, baseURL }) => {
  await open(page,baseURL);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content","noindex, nofollow");
  await expect(page.locator(".game-nav-bar")).toHaveCount(0);
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
  for (const id of secret) await expect(page.locator(".game-result")).toContainText(artifact.symbols.find((s: {qid:string}) => s.qid===id).name);
  await expect(page.getByRole("button",{name:"Enviar palpite"})).toBeDisabled();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test("English route and keyboard selection complete the same sample", async ({ page, baseURL }) => {
  await open(page,baseURL);
  await page.getByRole("link",{name:"English",exact:true}).click();
  await expect(page).toHaveURL(/\/en\/code-pilot\/$/);
  await expect(page.getByRole("heading",{name:"Group code",exact:true})).toBeVisible();
  await choose(page,secret,true);
  await page.getByRole("button",{name:"Submit guess"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".game-result")).toContainText("Code solved!");
  await expect(page.locator(".game-result")).toBeFocused();
});

for (const invalid of [false,true]) test(`missing/invalid pilot offers working retry (${invalid})`, async ({page,baseURL}) => {
  let calls = 0;
  await page.route("**/data/code-groups.pilot.json",async request => {
    calls++;
    if(calls===1) await request.fulfill(invalid ? {json:{...artifact,mode:"daily"}} : {status:404,body:"missing"});
    else await request.fulfill({json:artifact});
  });
  await page.goto(joinBaseUrl(baseURL!,prefix + route));
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await page.getByRole("button",{name:"Tentar novamente"}).click();
  await expect(page.locator("#code-groups")).toBeVisible();
  await choose(page,secret);
  await page.getByRole("button",{name:"Enviar palpite"}).click();
  await expect(page.locator(".game-result")).toContainText("Código descoberto!");
});


test.describe("touch pilot", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 740 } });
  test("touch submission solves the code", async ({page,baseURL}) => {
    await open(page,baseURL);
    await choose(page,secret);
    await page.getByRole("button",{name:"Enviar palpite"}).tap();
    await expect(page.locator(".game-result")).toContainText("Código descoberto!");
    await expect(page.locator(".code-slots select").first()).toBeDisabled();
  });
});
