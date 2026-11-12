import { act, fireEvent, render, screen } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { afterEach, expect, it, vi } from 'vitest';
import publishedJson from '../../../public/data/crossword-pilot.json';
import type { CrosswordPuzzle } from '../../data/crossword';
import { getMessages } from '../../i18n/catalog';
import { CrosswordGrid, type CrosswordInputs } from './CrosswordGrid';

const puzzle = publishedJson as unknown as CrosswordPuzzle;
function Grid({ wrongCells = new Set<string>() }: { wrongCells?: ReadonlySet<string> } = {}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [active, select] = useState(1);
  const inputs = useRef<CrosswordInputs>({});
  const cursor = useRef<string | null>(null);
  return <section class="crossword">
    <CrosswordGrid puzzle={puzzle} messages={getMessages('en')} values={values} finished={false}
      selected={puzzle.entries[active]!} inputs={inputs} wrongCells={wrongCells} cursor={cursor} onSelectEntry={select}
      onLetters={updates => setValues(previous => ({ ...previous, ...updates }))} />
    <div class="crossword-actions" style={{ position: 'sticky' }} />
  </section>;
}
const square = (row: number, col: number) => screen.getByRole('textbox', { name: new RegExp(`^Row ${row}, column ${col}\\.`) }) as HTMLInputElement;
const frame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
afterEach(() => vi.restoreAllMocks());

it('deletes the current letter, then the previous square without leaving the selected word', async () => {
  render(<Grid />);
  square(1, 1).focus();
  fireEvent.input(square(1, 1), { target: { value: 'bt' } });
  expect(square(3, 1)).toHaveFocus();
  fireEvent.keyDown(square(3, 1), { key: 'Backspace' });
  expect(square(2, 1)).toHaveFocus();
  expect(square(2, 1)).toHaveValue('');
  fireEvent.keyDown(square(2, 1), { key: 'Backspace', repeat: true });
  expect(square(1, 1)).toHaveFocus();
  expect(square(1, 1)).toHaveValue('');
  fireEvent.keyDown(square(1, 1), { key: 'Backspace', repeat: true });
  expect(square(1, 1)).toHaveFocus();
  fireEvent.input(square(1, 1), { target: { value: 'b' } });
  fireEvent.keyDown(square(1, 1), { key: 'Backspace' });
  expect(square(1, 1)).toHaveValue('');
  await frame();
});

it('scrolls the focused square above a sticky bar and ignores frames for the previous focus', async () => {
  render(<Grid />);
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('crossword-actions') ? 600 : 650;
    return { top, bottom: top + 44, left: 10, right: 54, width: 44, height: 44, x: 10, y: top, toJSON() {} };
  });
  square(1, 1).focus();
  square(2, 1).focus();
  await frame();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 102, behavior: 'instant' });
});

it('ignores a side panel outside the square and scrolls a square above the viewport back down', async () => {
  render(<Grid />);
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const bar = this.classList.contains('crossword-actions');
    const top = bar ? 600 : -20;
    const left = bar ? 500 : 10;
    return { top, bottom: top + 44, left, right: left + 44, width: 44, height: 44, x: left, y: top, toJSON() {} };
  });
  square(1, 1).focus();
  await frame();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: -28, behavior: 'instant' });
});

const inWord = (row: number, col: number) => square(row, col).closest('label')!.classList.contains('selected');

/** A tap or click: the press on the square, focus, then the click. */
function press(input: HTMLInputElement) {
  fireEvent.pointerDown(input);
  input.focus();
  fireEvent.click(input);
}

it('switches the word through a crossing when the focused square is pressed again', async () => {
  render(<Grid />);
  // Row 1, column 1 starts 1 Across (BTS) and 1 Down (BTOB); 1 Down is selected.
  press(square(1, 1));
  expect(inWord(2, 1)).toBe(true);
  expect(inWord(1, 2)).toBe(false);
  press(square(1, 1));
  expect(inWord(1, 2)).toBe(true);
  expect(inWord(2, 1)).toBe(false);
  expect(square(1, 1)).toHaveFocus();
  press(square(1, 1));
  expect(inWord(2, 1)).toBe(true);
  await frame();
});

it('keeps the word when a square outside a crossing is pressed again', async () => {
  render(<Grid />);
  press(square(2, 1));
  press(square(2, 1));
  expect(inWord(2, 1)).toBe(true);
  expect(inWord(1, 2)).toBe(false);
  await frame();
});

it('marks the squares of the last check as invalid', () => {
  render(<Grid wrongCells={new Set(['0:1', '5:2'])} />);
  expect(square(1, 2)).toHaveAttribute('aria-invalid', 'true');
  expect(square(1, 2).closest('label')).toHaveClass('is-wrong');
  expect(square(6, 3)).toHaveAttribute('aria-invalid', 'true');
  expect(square(1, 1)).not.toHaveAttribute('aria-invalid');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
});
