import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { getMessages } from "../../i18n/catalog";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";
import type { Locale } from "../../lib/quiz-types";
import { WordSearchGame } from "./WordSearchGame";
import { generateWordSearchShareSummary } from "./utils";

// Pins the rendered DOM, the focused element, the stored data and the
// analytics events of every Word Search state, so splitting the game can be
// checked against the code it replaces.

const puzzle = validPuzzleJson as unknown as WordSearchPuzzle;
const storageKey = `kpop-word-search-${puzzle.puzzle_id}`;
const word = (text: string) => puzzle.words.find((w) => w.word === text)!;

let gtag = vi.fn();

function describeFocus(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "body";
  const id = element.id ? `#${element.id}` : "";
  const cellAt = element.hasAttribute("data-row") ? `[${element.getAttribute("data-row")},${element.getAttribute("data-col")}]` : "";
  const name = element.getAttribute("aria-label") ?? element.textContent;
  return `${element.tagName.toLowerCase()}${id}${cellAt} ${JSON.stringify(name)}`;
}

/** Every stored key, sorted, so the save and the recorded match both show. */
function storage(): Record<string, string | null> {
  const keys = Object.keys(localStorage).sort();
  return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
}

/** The game as the player meets it: markup, focus and what is stored. */
function capture(container: Element) {
  return {
    html: container.innerHTML,
    focus: describeFocus(),
    storage: storage(),
  };
}

function at(container: Element, row: number, col: number): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)!;
}

function tap(container: Element, row: number, col: number) {
  fireEvent.pointerDown(at(container, row, col));
  fireEvent.pointerUp(at(container, row, col));
}

/** Drags from the first letter of a word to the last one. */
function select(container: Element, target: WordSearchWord) {
  fireEvent.pointerDown(at(container, target.start_row, target.start_col));
  fireEvent.pointerMove(at(container, target.end_row, target.end_col), { buttons: 1 });
  fireEvent.pointerUp(at(container, target.end_row, target.end_col));
}

function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

/** Moves the keyboard focus from the focused cell to another, one arrow at a time. */
function walkTo(to: { row: number; col: number }) {
  const from = document.activeElement as HTMLElement;
  const row = Number(from.dataset.row);
  const col = Number(from.dataset.col);
  for (let r = row; r < to.row; r++) press("ArrowDown");
  for (let r = row; r > to.row; r--) press("ArrowUp");
  for (let c = col; c < to.col; c++) press("ArrowRight");
  for (let c = col; c > to.col; c--) press("ArrowLeft");
}

function tick(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

function click(name: string) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

function setNavigator(key: "share" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}

const original = {
  share: Object.getOwnPropertyDescriptor(navigator, "share"),
  clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  scrollIntoView: Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView"),
};

/** Presses Share, whose label reads "copied" after a copy. */
async function pressShare() {
  const button = document.querySelector<HTMLButtonElement>(".word-search-result-buttons .btn-primary")!;
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
}

/** Lets the dialog's delayed focus and pending promises run. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await act(async () => {});
}

function store(save: unknown) {
  localStorage.setItem(storageKey, JSON.stringify(save));
}

/** Lays the cells out as 24px squares every 26px, as jsdom has no layout. */
const PITCH = 26;
const center = (index: number) => index * PITCH + 12;
function layOutCells(): () => void {
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = Number(this.dataset.row ?? 0);
    const col = Number(this.dataset.col ?? 0);
    const x = col * PITCH;
    const y = row * PITCH;
    return { x, y, left: x, top: y, width: 24, height: 24, right: x + 24, bottom: y + 24, toJSON: () => ({}) } as DOMRect;
  });
  return () => spy.mockRestore();
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(`${puzzle.reference_date}T15:00:00Z`));
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value() {} });
  gtag = vi.fn();
  vi.stubGlobal("gtag", gtag);
  setGameAnalyticsConsent("G-TEST", true);
  setNavigator("share", undefined);
});

afterEach(() => {
  cleanup();
  setGameAnalyticsConsent("", false);
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of ["share", "clipboard"] as const) {
    const descriptor = original[key];
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
  if (original.scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", original.scrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("word search characterization", () => {
  it.each(["pt-BR", "en"] as const)("renders the play, win and share states the same way in %s", async (locale: Locale) => {
    const messages = getMessages(locale);
    const t = messages.wordSearch;
    const { container } = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    expect(capture(container)).toMatchSnapshot("01 initial");

    const shindong = word("SHINDONG");
    tap(container, shindong.start_row, shindong.start_col);
    expect(capture(container)).toMatchSnapshot("02 start marked by a tap");

    fireEvent.pointerMove(at(container, 3, 10));
    expect(capture(container)).toMatchSnapshot("03 line drawn from the start");

    tap(container, shindong.start_row, shindong.start_col);
    expect(capture(container)).toMatchSnapshot("04 start cancelled by a second tap");

    fireEvent.pointerDown(at(container, shindong.start_row, shindong.start_col));
    fireEvent.pointerMove(at(container, 2, 10), { buttons: 1 });
    expect(capture(container)).toMatchSnapshot("05 drag in progress");

    fireEvent.pointerMove(at(container, shindong.end_row, shindong.end_col), { buttons: 1 });
    fireEvent.pointerUp(at(container, shindong.end_row, shindong.end_col));
    expect(capture(container)).toMatchSnapshot("06 word found");

    select(container, shindong);
    expect(capture(container)).toMatchSnapshot("07 word already found");

    tap(container, 0, 1);
    tap(container, 0, 3);
    expect(capture(container)).toMatchSnapshot("08 letters that are no name");

    tap(container, 7, 10);
    tap(container, 4, 10);
    expect(capture(container)).toMatchSnapshot("09 piece of a found name");

    tap(container, 0, 5);
    tap(container, 0, 6);
    expect(capture(container)).toMatchSnapshot("10 two letters of no name");

    tap(container, 0, 0);
    tap(container, 1, 2);
    expect(capture(container)).toMatchSnapshot("11 second tap off the line");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(capture(container)).toMatchSnapshot("12 start cancelled by Esc outside the grid");

    // SUNGMIN, the last token of Lee Sungmin, counts as the name.
    tap(container, 3, 0);
    tap(container, 9, 0);
    expect(capture(container)).toMatchSnapshot("13 name found by its last token");

    tick(3);
    expect(capture(container)).toMatchSnapshot("14 timer after three seconds");

    click(t.showWords);
    expect(capture(container)).toMatchSnapshot("15 words shown");

    click(t.hideWords);
    expect(capture(container)).toMatchSnapshot("16 words hidden");

    // Keyboard: Tab reaches the cell that holds the roving tabindex.
    const leeteuk = word("LEETEUK");
    const start = { row: leeteuk.start_row, col: leeteuk.start_col };
    container.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')!.focus();
    walkTo(start);
    expect(capture(container)).toMatchSnapshot("17 focus moved by the arrows");

    press("Enter");
    expect(capture(container)).toMatchSnapshot("18 start marked by Enter");

    walkTo({ row: start.row, col: start.col + 2 });
    expect(capture(container)).toMatchSnapshot("19 line drawn by the arrows");

    press("Escape");
    expect(capture(container)).toMatchSnapshot("20 start cancelled by Esc in the grid");

    walkTo(start);
    press(" ");
    // The arrows reach the end in an L; Enter closes the line between the ends.
    walkTo({ row: leeteuk.end_row, col: start.col });
    walkTo({ row: leeteuk.end_row, col: leeteuk.end_col });
    press("Enter");
    expect(capture(container)).toMatchSnapshot("21 word found with the keyboard");

    select(container, word("KIMHEECHUL"));
    expect(capture(container)).toMatchSnapshot("22 one word left");

    const eunhyuk = word("EUNHYUK");
    fireEvent.pointerDown(at(container, eunhyuk.end_row, eunhyuk.end_col));
    fireEvent.pointerMove(at(container, eunhyuk.start_row, eunhyuk.start_col), { buttons: 1 });
    fireEvent.pointerUp(at(container, eunhyuk.start_row, eunhyuk.start_col));
    await settle();
    expect(capture(container)).toMatchSnapshot("23 won");

    // A finished board ignores input.
    tap(container, 0, 0);
    tick(5);
    expect(capture(container)).toMatchSnapshot("24 input after the win");

    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await pressShare();
    expect(capture(container)).toMatchSnapshot("25 share copied");
    await pressShare();
    expect(capture(container)).toMatchSnapshot("26 share copied again");
    expect(writeText.mock.calls).toMatchSnapshot("26 clipboard text");

    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await pressShare();
    expect(capture(container)).toMatchSnapshot("27 share failed");

    click(messages.showSource);
    expect(capture(container)).toMatchSnapshot("28 sources open");

    await settle();
    expect(gtag.mock.calls).toMatchSnapshot("29 analytics events");
  });

  it.each(["pt-BR", "en"] as const)("gives up the same way in %s", async (locale: Locale) => {
    const messages = getMessages(locale);
    const { container } = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    select(container, word("SHINDONG"));
    tap(container, 0, 0);
    tick(7);
    expect(capture(container)).toMatchSnapshot("01 one word found and a start marked");

    click(messages.giveUp);
    await settle();
    expect(capture(container)).toMatchSnapshot("02 give-up confirmation open");

    click(messages.cancel);
    await settle();
    expect(capture(container)).toMatchSnapshot("03 give-up cancelled");

    click(messages.giveUp);
    await settle();
    click(messages.giveUpConfirmAction);
    await settle();
    expect(capture(container)).toMatchSnapshot("04 given up with the words revealed");

    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    await pressShare();
    expect(capture(container)).toMatchSnapshot("05 shared with the share sheet");
    expect(share.mock.calls).toMatchSnapshot("05 share sheet text");

    await settle();
    expect(gtag.mock.calls).toMatchSnapshot("06 analytics events");
  });

  it.each(["pt-BR", "en"] as const)("restores saved rounds the same way in %s", async (locale: Locale) => {
    const found = [word("SHINDONG").id, word("LEETEUK").id];
    store({ foundWordIds: found, elapsedSeconds: 42, status: "in_progress", easyMode: true });
    let view = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    expect(capture(view.container)).toMatchSnapshot("01 open round with words shown");

    cleanup();
    store({ foundWordIds: found, elapsedSeconds: 42, status: "in_progress", clueMode: true });
    view = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    expect(capture(view.container)).toMatchSnapshot("02 open round saved with the old clue mode");

    cleanup();
    localStorage.clear();
    store({ foundWordIds: puzzle.words.map((w) => w.id), elapsedSeconds: 125, status: "completed", easyMode: false });
    view = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("03 restored win");

    cleanup();
    localStorage.clear();
    store({ foundWordIds: found, elapsedSeconds: 61, status: "completed", easyMode: true });
    view = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("04 restored give-up");

    cleanup();
    localStorage.removeItem(storageKey);
    view = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("05 day already recorded for a dropped save");
  });

  it("starts over from saves it refuses", () => {
    const id = puzzle.words[0]!.id;
    const saves: unknown[] = [
      "not json",
      null,
      [],
      { foundWordIds: "Q1" },
      { foundWordIds: [id, id] },
      { foundWordIds: ["Q1"] },
      { foundWordIds: [1] },
      { foundWordIds: [id], elapsedSeconds: -1, status: "done", easyMode: "yes" },
      { foundWordIds: [id], elapsedSeconds: Number.NaN, status: "completed", clueMode: 1 },
      { foundWordIds: [], elapsedSeconds: 9, status: "completed", easyMode: false, clueMode: true },
    ];
    const restored = saves.map((save) => {
      localStorage.clear();
      if (typeof save === "string") localStorage.setItem(storageKey, save);
      else store(save);
      const view = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
      const state = {
        counter: view.container.querySelector(".word-search-progress")?.textContent ?? null,
        result: screen.queryByTestId("game-result")?.textContent ?? null,
        storage: storage(),
      };
      view.unmount();
      return state;
    });
    expect(restored).toMatchSnapshot();
  });

  it("pins the raw save written after each step", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const saves: Array<string | null> = [localStorage.getItem(storageKey)];
    tick(2);
    saves.push(localStorage.getItem(storageKey));
    select(container, word("SHINDONG"));
    saves.push(localStorage.getItem(storageKey));
    fireEvent.click(screen.getByRole("button", { name: getMessages("pt-BR").wordSearch.showWords }));
    saves.push(localStorage.getItem(storageKey));
    for (const w of puzzle.words) select(container, w);
    saves.push(localStorage.getItem(storageKey));
    tick(3);
    saves.push(localStorage.getItem(storageKey));
    expect(saves).toMatchSnapshot();
  });

  it.each(["pt-BR", "en"] as const)("follows a touch drag by coordinates the same way in %s", (locale: Locale) => {
    const { container } = render(<WordSearchGame locale={locale} puzzle={puzzle} />);
    const grid = screen.getByRole("grid");
    const shindong = word("SHINDONG");
    const startCell = at(container, shindong.start_row, shindong.start_col);
    const steps: unknown[] = [];
    const restore = layOutCells();
    try {
      // A press that trembles less than half a cell stays a tap.
      fireEvent.pointerDown(startCell, { clientX: center(10), clientY: center(7), buttons: 1, pointerId: 3 });
      fireEvent.pointerMove(startCell, { clientX: center(10) + 4, clientY: center(7) - 5, buttons: 1, pointerId: 3 });
      steps.push(capture(container));
      fireEvent.pointerUp(startCell, { clientX: center(10) + 4, clientY: center(7) - 5, pointerId: 3 });
      steps.push(capture(container));

      // A drag from the marked start draws its own line; a second finger is ignored.
      fireEvent.pointerDown(startCell, { clientX: center(10), clientY: center(7), buttons: 1, pointerId: 3 });
      fireEvent.pointerDown(at(container, 0, 0), { clientX: center(0), clientY: center(0), buttons: 1, pointerId: 4 });
      fireEvent.pointerMove(startCell, { clientX: center(10) + 9, clientY: center(3), buttons: 1, pointerId: 3 });
      steps.push(capture(container));
      fireEvent.pointerMove(grid, { clientX: center(10) - 8, clientY: -20, buttons: 1, pointerId: 3 });
      steps.push(capture(container));
      fireEvent.pointerUp(startCell, { clientX: center(10) - 8, clientY: -20, pointerId: 3 });
      steps.push(capture(container));

      // The browser takes a press over before it drags: the selection stays as it was.
      fireEvent.pointerDown(at(container, 2, 2), { clientX: center(2), clientY: center(2), buttons: 1, pointerId: 5 });
      fireEvent.pointerCancel(window, { pointerId: 5 });
      steps.push(capture(container));

      // ...and during a drag: the selection is dropped.
      fireEvent.pointerDown(at(container, 2, 2), { clientX: center(2), clientY: center(2), buttons: 1, pointerId: 6 });
      fireEvent.pointerMove(grid, { clientX: center(5), clientY: center(2), buttons: 1, pointerId: 6 });
      fireEvent.pointerCancel(window, { pointerId: 6 });
      steps.push(capture(container));

      // A drag lifted off the grid stops at the last cell it reached.
      fireEvent.pointerDown(at(container, 0, 0), { clientX: center(0), clientY: center(0), buttons: 1, pointerId: 7 });
      fireEvent.pointerMove(grid, { clientX: center(0), clientY: center(9), buttons: 1, pointerId: 7 });
      fireEvent.pointerUp(window, { pointerId: 7 });
      steps.push(capture(container));
    } finally {
      restore();
    }
    expect(steps).toMatchSnapshot();
  });

  it("pins the share text of a win and a give-up in both languages", () => {
    const total = puzzle.words.length;
    expect({
      wonPt: generateWordSearchShareSummary(puzzle, total, total, 125, "pt-BR"),
      wonEn: generateWordSearchShareSummary(puzzle, total, total, 125, "en"),
      gaveUpPt: generateWordSearchShareSummary(puzzle, 2, total, 3725, "pt-BR"),
      gaveUpEn: generateWordSearchShareSummary(puzzle, 2, total, 3725, "en"),
    }).toMatchSnapshot();
  });
});
