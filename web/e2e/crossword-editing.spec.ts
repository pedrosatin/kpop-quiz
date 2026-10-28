import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { joinBaseUrl } from '../src/lib/join-base-url';
import { reloadPersisted, settleEffects } from './helpers/passive-effects';
import { gamePlayed } from './helpers/player-stats';
import { RESULT_GUARD_MS } from '../src/components/Results/use-result-action-guard';

const evidence = process.env.CROSSWORD_EVIDENCE;
const phase = process.env.CROSSWORD_PHASE ?? 'after';
const prefix = process.env.ASTRO_BASE?.replace(/\/$/, '') ?? '';
const puzzle = JSON.parse(readFileSync(new URL('../public/data/crossword-pilot.json', import.meta.url), 'utf8'));
const locales = {
  pt: { path: '/pt-br/cruzadinha/', down: 'Vertical', across: 'Horizontal', reject: 'Recusar Google Analytics' },
  en: { path: '/en/crossword/', down: 'Down', across: 'Across', reject: 'Reject Google Analytics' },
};

async function geometry(input: Locator) {
  return input.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points = [[r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]];
    return {
      label: el.getAttribute('aria-label'), value: (el as HTMLInputElement).value,
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      visible: r.top >= 0 && r.bottom <= innerHeight && points.every(([x, y]) => document.elementFromPoint(x!, y!) === el),
      hit: points.map(([x, y]) => document.elementFromPoint(x!, y!)?.outerHTML.slice(0, 180)),
    };
  });
}

async function capture(page: Page, id: string, input: Locator) {
  const measured = await geometry(input);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${phase}-${id}.png` });
    writeFileSync(`${evidence}/${phase}-${id}.json`, JSON.stringify(measured, null, 2));
  }
  return measured;
}

for (const [locale, t] of Object.entries(locales)) {
  for (const [width, height] of [[360, 800], [390, 844], [1280, 800]]) {
    for (const consent of ['open', 'rejected']) {
      test(`${locale} ${width}x${height} ${consent}: active square stays above overlays`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ viewport: { width: width!, height: height! }, hasTouch: width! < 600 });
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
          Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        });
        const page = await context.newPage();
        await page.goto(joinBaseUrl(baseURL!, prefix + t.path));
        await expect(page.locator('#crossword input')).toHaveCount(11);
        // Builds without analytics configuration have no consent banner.
        const hasBanner = await page.locator('.consent-banner').isVisible();
        if (consent === 'rejected' && hasBanner) await page.getByRole('button', { name: t.reject, exact: true }).click();
        await page.locator('#crossword').getByRole('button', { name: new RegExp(`^2 ${t.down}:`) }).click();
        const id = `${locale}-${width}-${consent}`;
        for (const letter of 'sistar') {
          await page.keyboard.type(letter);
          await expect.poll(async () => geometry(page.locator('#crossword input:focus')).then(r => r.visible)).toBe(true);
        }
        const last = page.locator('#crossword input').last();
        await expect(last).toBeFocused();
        await expect(last).toHaveValue('R');
        const measured = await capture(page, id, last);
        expect(measured.visible, JSON.stringify(measured)).toBe(true);
        // Scroll, then return through a native tap/click and edit the last square.
        await page.mouse.wheel(0, 280);
        await last.scrollIntoViewIfNeeded();
        if (width! < 600) await last.tap(); else await last.click();
        await page.keyboard.type('7');
        await expect(last).toHaveValue('7');
        expect((await geometry(last)).visible).toBe(true);
        await page.keyboard.press('Backspace');
        await expect(last).toHaveValue('');
        await page.keyboard.press('Backspace');
        await expect(page.locator('#crossword input').nth(9)).toBeFocused();
        await expect(page.locator('#crossword input').nth(9)).toHaveValue('');
        expect((await geometry(page.locator('#crossword input').nth(9))).visible).toBe(true);
        await expect(page.locator('.crossword-actions')).toHaveCSS('position', width! >= 960 ? 'relative' : consent === 'open' && hasBanner ? 'static' : 'sticky');
        if (consent === 'open' && hasBanner) await expect(page.locator('.consent-banner')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect.poll(() => page.evaluate(() => {
          const key = Object.keys(localStorage).find(k => k.startsWith('kpop-crossword-'));
          return key ? JSON.parse(localStorage.getItem(key)!).values['4:2'] : null;
        })).toBe('');
        await reloadPersisted(page);
        await expect(last).toHaveValue('');
        await expect(page.locator('#crossword input').nth(8)).toHaveValue('T');
        const board = page.locator('#crossword');
        for (const entry of puzzle.entries) {
          await board.getByRole('button', { name: new RegExp(`^${entry.number} ${entry.direction === 'across' ? t.across : t.down}:`) }).click();
          await page.keyboard.type(entry.answer.toLowerCase());
        }
        const check = locale === 'pt' ? 'Verificar respostas' : 'Check answers';
        await board.getByRole('button', { name: check, exact: true }).click();
        await expect(board.getByRole('heading', { name: locale === 'pt' ? 'Cruzadinha concluída!' : 'Crossword completed!' })).toBeFocused();
        await expect(board.locator('input:enabled')).toHaveCount(0);
        await board.getByRole('button', { name: locale === 'pt' ? 'Ver fonte' : 'Show source', exact: true }).click();
        await expect(board.locator('.crossword-source a[href*="oldid="]')).toHaveCount(puzzle.entries.flatMap((e: { sources: unknown[] }) => e.sources).length);
        for (const entry of puzzle.entries) await expect(board.locator('.crossword-source')).toContainText(entry.sources[0].snippet);
        // Read source URLs without visiting any third party.
        await page.waitForTimeout(RESULT_GUARD_MS + 1);
        await board.getByRole('button', { name: locale === 'pt' ? 'Compartilhar resultado' : 'Share result', exact: true }).click();
        await expect(board.locator('.share-preview')).toHaveValue(
          locale === 'pt' ? /Cruzadinha de K-pop/ : /K-pop Crossword/,
        );
        await reloadPersisted(page);
        await expect(board.getByRole('heading', { name: locale === 'pt' ? 'Cruzadinha concluída!' : 'Crossword completed!' })).toBeVisible();
        await context.close();
      });
    }
  }

  test(`${locale}: Backspace follows only the selected word, preserving crossings and focus`, async ({ page, baseURL }) => {
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.goto(joinBaseUrl(baseURL!, prefix + t.path));
    await expect(page.locator('#crossword input')).toHaveCount(11);
    if (await page.locator('.consent-banner').isVisible()) await page.getByRole('button', { name: t.reject, exact: true }).click();
    const board = page.locator('#crossword');
    const cells = board.locator('input');
    await board.getByRole('button', { name: new RegExp(`^1 ${t.down}:`) }).click();
    await page.keyboard.type('bt');
    await expect(cells.nth(5)).toBeFocused();
    await page.keyboard.press('Backspace');
    const before = await capture(page, `${locale}-backspace`, cells.nth(3));
    expect(before.value).toBe('');
    await expect(cells.nth(3)).toBeFocused();
    await expect(cells.first()).toHaveValue('B');
    await expect(board.getByTestId('crossword-active-clue')).toContainText(`1 ${t.down}`);
    // Holding Backspace produces repeated keydowns and stops at the first square.
    await page.keyboard.down('Backspace');
    await page.keyboard.down('Backspace');
    await page.keyboard.down('Backspace');
    await page.keyboard.up('Backspace');
    await expect(cells.first()).toBeFocused();
    await expect(cells.first()).toHaveValue('');
    await expect(board.getByTestId('crossword-active-clue')).toContainText(`1 ${t.down}`);
    await page.keyboard.type('b');
    await page.keyboard.press('Backspace');
    await expect(cells.first()).toBeFocused();
    await expect(cells.first()).toHaveValue('');
    // At the beginning of the other vertical word, never move across the block.
    await board.getByRole('button', { name: new RegExp(`^2 ${t.down}:`) }).click();
    await page.keyboard.press('Backspace');
    await expect(cells.nth(2)).toBeFocused();
    await expect(board.getByTestId('crossword-active-clue')).toContainText(`2 ${t.down}`);
    await page.keyboard.type('sistar');
    await page.keyboard.press('Backspace');
    await expect(cells.last()).toBeFocused();
    await expect(cells.last()).toHaveValue('');
    await page.keyboard.press('Backspace');
    await expect(cells.nth(9)).toBeFocused();
    await expect(cells.nth(9)).toHaveValue('');
    await expect(cells.nth(8)).toHaveValue('T');
    // Same crossing, explicitly selected across direction.
    await board.getByRole('button', { name: new RegExp(`^1 ${t.across}:`) }).click();
    await page.keyboard.type('bt');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await expect(cells.nth(1)).toBeFocused();
    await expect(cells.nth(1)).toHaveValue('');
    await expect(board.getByTestId('crossword-active-clue')).toContainText(`1 ${t.across}`);
    // Arrow navigation retains its existing block-skipping behavior.
    await page.keyboard.press('ArrowDown');
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cells.nth(2)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cells.nth(3)).toBeFocused();
    await expect(board.getByTestId('crossword-active-clue')).toContainText(`1 ${t.down}`);
    await page.keyboard.press('ArrowRight');
    await expect(cells.nth(4)).toBeFocused();
    await expect(board.getByTestId('crossword-active-clue')).toContainText(`2 ${t.down}`);
  });

  test(`${locale}: revealing still ends and restores the round only once`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.goto(joinBaseUrl(baseURL!, prefix + t.path));
    const board = page.locator('#crossword');
    await expect(board.locator('input')).toHaveCount(11);
    if (await page.locator('.consent-banner').isVisible()) await page.getByRole('button', { name: t.reject, exact: true }).click();
    await board.getByRole('button', { name: locale === 'pt' ? 'Revelar respostas' : 'Reveal answers', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: locale === 'pt' ? 'Sim, revelar' : 'Yes, reveal', exact: true }).click();
    const title = locale === 'pt' ? 'Respostas reveladas' : 'Answers revealed';
    await expect(board.getByRole('heading', { name: title })).toBeFocused();
    await expect(board.locator('input:enabled')).toHaveCount(0);
    for (let i = 0; i < puzzle.cells.length; i++) await expect(board.locator('input').nth(i)).toHaveValue(puzzle.cells[i].answer);
    await reloadPersisted(page);
    await expect(board.getByRole('heading', { name: title })).toBeVisible();
    await settleEffects(page);
    expect(await gamePlayed(page, 'crossword')).toBe(1);
  });
}
