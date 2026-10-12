import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
function canonical(value: any): any {return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)])):value;}
function checksum(p: any) {const {dataset_version,...content}=p;p.dataset_version=createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');}
const puzzle = JSON.parse(readFileSync(new URL('../public/data/crossword-pilot.json', import.meta.url), 'utf8'));
const prefix = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:4321').pathname.replace(/\/$/, '');
for (const locale of ['pt-br', 'en'])
    test(`crossword pilot completes in ${locale}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`${prefix}/${locale}/${locale === 'en' ? 'crossword-pilot' : 'cruzadinha-piloto'}/`);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
        const board = page.locator('#crossword');
        await expect(board.locator('input')).toHaveCount(puzzle.cells.length);
        await expect(board.getByRole('heading', { name: locale === 'en' ? 'Answers and sources' : 'Respostas e fontes' })).toHaveCount(0);
        await board.getByRole('button', { name: locale === 'en' ? 'Check board' : 'Verificar grade', exact: true }).click();
        await expect(board.getByRole('status')).toContainText(locale === 'en' ? 'incorrect' : 'incorretas');
        // Select each clue via touch-equivalent click, then type the entire answer with automatic cell advancement.
        for (const e of puzzle.entries) {
            await board.getByRole('button', { name: new RegExp(`^${e.number} ${e.direction === 'across' ? (locale === 'en' ? 'Across' : 'Horizontal') : (locale === 'en' ? 'Down' : 'Vertical')}:`) }).click();
            await page.keyboard.type(e.answer.toLowerCase());
        }
        await board.getByRole('button', { name: locale === 'en' ? 'Check board' : 'Verificar grade', exact: true }).click();
        await expect(board.getByRole('status')).toHaveText(locale === 'en' ? 'Crossword completed!' : 'Cruzadinha concluída!');
        await expect(board.locator('input:enabled')).toHaveCount(0);
        await expect(board.locator('a[href*="oldid="]')).toHaveCount(5);
        for (const e of puzzle.entries)
            await expect(board.getByText(e.canonical_name, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
test('missing and invalid crossword offer retry without a fallback', async ({ page }) => {
    let attempt = 0;
    await page.route('**/data/crossword-pilot.json', route => {
        attempt++;
        if (attempt === 1)
            return route.fulfill({ status: 404, body: '' });
        if (attempt === 2)
            return route.fulfill({ json: { ...puzzle, cells: [] } });
        if (attempt === 3 || attempt === 4) {
            const invalid = structuredClone(puzzle);
            invalid.entries[0].sources[0].locator = invalid.entries[0].sources[0].locator.replace(/\[\d+:\d+\]$/, attempt === 3 ? '[10:10]' : '[20:10]');
            checksum(invalid);
            return route.fulfill({ json: invalid });
        }
        return route.fulfill({ json: puzzle });
    });
    await page.goto(`${prefix}/en/crossword-pilot/`);
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await page.getByRole('button', { name: 'Try again' }).click();
    for (let invalid = 0; invalid < 2; invalid++) {
        await expect(page.getByRole('alert')).toContainText('could not be loaded');
        await page.getByRole('button', { name: 'Try again' }).click();
    }
    await expect(page.locator('#crossword input')).toHaveCount(puzzle.cells.length);
    await page.getByRole('button', { name: 'Finish and reveal' }).click();
    await expect(page.getByRole('status')).toContainText('Round ended');
});
test('keyboard editing, crossed clues and digits remain playable', async ({ page }) => {
    const numeric = structuredClone(puzzle);
    numeric.entries[1].canonical_name = 'Bt0B';
    numeric.entries[1].answer = 'BT0B';
    numeric.cells.find((c: {
        row: number;
        col: number;
    }) => c.row === 2 && c.col === 0).answer = '0';
    checksum(numeric);
    await page.route('**/data/crossword-pilot.json', route => route.fulfill({ json: numeric }));
    await page.goto(`${prefix}/en/crossword-pilot/`);
    const board = page.locator('#crossword');
    await board.getByRole('button', { name: /^1 Down:/ }).click();
    await page.keyboard.type('ｂｔ０ｂ');
    await expect(board.getByRole('textbox', { name: /Row 3, column 1/ })).toHaveValue('0');
    await board.getByRole('button', { name: /^1 Across:/ }).click();
    await page.keyboard.type('xxx');
    await board.getByRole('button', { name: 'Check board', exact: true }).click();
    await expect(board.getByRole('status')).toContainText('incorrect');
    const first = board.getByRole('textbox', { name: /Row 1, column 1/ });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(board.getByRole('textbox', { name: /Row 1, column 2/ })).toBeFocused();
    for (const e of numeric.entries) {
        await board.getByRole('button', { name: new RegExp(`^${e.number} ${e.direction === 'across' ? 'Across' : 'Down'}:`) }).click();
        await page.keyboard.type(e.answer);
    }
    await board.getByRole('button', { name: 'Check board', exact: true }).click();
    await expect(board.getByTestId('game-result')).toBeVisible();
    await expect(board.getByRole('status')).toHaveText('Crossword completed!');
});
