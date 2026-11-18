import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { getMessages } from "../../i18n/catalog";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";
import type { Locale } from "../../lib/quiz-types";
import { onDay } from "../../test/stale-daily";
import { RESULT_GUARD_MS } from "../Results/use-result-action-guard";
import { CodeGroupsGame } from "./CodeGroupsGame";
import { generateShareText } from "./code-groups-text";

// Pins the rendered DOM, the focused element, the scroll calls, the raw save
// and the analytics events of every Code state, so splitting the game can be
// checked against the code it replaces.

const puzzle = validPuzzleJson as unknown as CodeGroupsPuzzle;
const storageKey = `kpop-code-${puzzle.reference_date}`;
const secret = puzzle.secret as string[];
const unused = puzzle.symbols.map((s) => s.qid).filter((id) => !secret.includes(id));

let clock = 1000;
let scrolls: unknown[] = [];
let gtag = vi.fn();

function describeFocus(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "body";
  const id = element.id ? `#${element.id}` : "";
  const testId = element.getAttribute("data-testid");
  const name = element.getAttribute("aria-label") ?? element.textContent;
  return `${element.tagName.toLowerCase()}${id}${testId ? `[${testId}]` : ""} ${JSON.stringify(name)}`;
}

/** The game as the player meets it: markup, focus, scrolls since the last capture and the raw save. */
function capture(container: Element) {
  const state = {
    html: container.innerHTML,
    focus: describeFocus(),
    scrolls,
    saved: localStorage.getItem(storageKey),
  };
  scrolls = [];
  return state;
}

function serve(board: CodeGroupsPuzzle = puzzle) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(board)))));
}

async function renderLoaded(locale: Locale) {
  serve();
  const view = render(<CodeGroupsGame locale={locale} />);
  await screen.findAllByRole("combobox");
  return view;
}

// Each control takes focus before it acts, as it does under a pointer or a
// keyboard, so the captures show where focus stays or moves.
function selectSlot(index: number, qid: string) {
  const slot = screen.getAllByRole("combobox")[index]!;
  slot.focus();
  fireEvent.change(slot, { target: { value: qid } });
}

function send(locale: Locale) {
  const button = screen.getByRole("button", { name: getMessages(locale).codeSubmit });
  button.focus();
  fireEvent.click(button);
}

function guess(locale: Locale, ids: readonly string[]) {
  ids.forEach((id, index) => selectSlot(index, id));
  send(locale);
}

/** Distinct orders of the secret that miss it, enough to run out of attempts. */
function wrongGuesses(count: number): string[][] {
  const orders = (ids: string[]): string[][] =>
    ids.length <= 1 ? [ids] : ids.flatMap((id, i) => orders(ids.filter((_, j) => j !== i)).map((rest) => [id, ...rest]));
  return orders(secret).filter((ids) => ids.join() !== secret.join()).slice(0, count);
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await act(async () => {});
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
  clock += RESULT_GUARD_MS + 1;
  const button = document.querySelector<HTMLButtonElement>(".code-result-buttons button")!;
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  localStorage.clear();
  onDay(puzzle.reference_date);
  clock = 1000;
  scrolls = [];
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(window, "scrollBy").mockImplementation(((x: number, y: number) => {
    scrolls.push(["scrollBy", x, y]);
  }) as typeof window.scrollBy);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element, options: unknown) {
      scrolls.push(["scrollIntoView", this.getAttribute("data-testid"), options]);
    },
  });
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

describe("code characterization", () => {
  it.each(["pt-BR", "en"] as const)("renders the play, win and share states the same way in %s", async (locale: Locale) => {
    serve();
    const view = render(<CodeGroupsGame locale={locale} />);
    expect(capture(view.container)).toMatchSnapshot("01 loading");

    await screen.findAllByRole("combobox");
    expect(capture(view.container)).toMatchSnapshot("02 initial");

    send(locale);
    expect(capture(view.container)).toMatchSnapshot("03 empty slots refused");

    guess(locale, [secret[0]!, secret[0]!, secret[1]!, secret[2]!]);
    expect(capture(view.container)).toMatchSnapshot("04 repeated group refused");

    guess(locale, [secret[1]!, secret[0]!, unused[0]!, secret[3]!]);
    expect(capture(view.container)).toMatchSnapshot("05 valid wrong attempt");

    send(locale);
    expect(capture(view.container)).toMatchSnapshot("06 guess already sent refused");

    selectSlot(2, secret[2]!);
    expect(capture(view.container)).toMatchSnapshot("07 slot changed after the feedback");

    send(locale);
    expect(capture(view.container)).toMatchSnapshot("08 second attempt");

    guess(locale, secret);
    expect(capture(view.container)).toMatchSnapshot("09 won");

    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await pressShare();
    expect(capture(view.container)).toMatchSnapshot("10 share copied");
    expect(writeText.mock.calls).toMatchSnapshot("10 clipboard text");

    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await pressShare();
    expect(capture(view.container)).toMatchSnapshot("11 share failed");

    await settle();
    expect(gtag.mock.calls).toMatchSnapshot("12 analytics events");
  });

  it.each(["pt-BR", "en"] as const)("reveals the code when the attempts run out in %s", async (locale: Locale) => {
    const view = await renderLoaded(locale);
    const guesses = wrongGuesses(puzzle.max_attempts);
    for (const ids of guesses.slice(0, -1)) guess(locale, ids);
    expect(capture(view.container)).toMatchSnapshot("01 one attempt left");

    guess(locale, guesses.at(-1)!);
    expect(capture(view.container)).toMatchSnapshot("02 lost with the code revealed");

    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await pressShare();
    expect(capture(view.container)).toMatchSnapshot("03 lost share failed");

    await settle();
    expect(gtag.mock.calls).toMatchSnapshot("04 analytics events");
  });

  it.each(["pt-BR", "en"] as const)("restores saved rounds the same way in %s", async (locale: Locale) => {
    const played = secret.slice(1).concat(secret.slice(0, 1));
    const picked = [secret[0]!, unused[0]!, "", ""];
    localStorage.setItem(storageKey, JSON.stringify({ puzzle_id: puzzle.puzzle_id, history: [played], selection: picked }));
    let view = await renderLoaded(locale);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("01 restored open round with a partial pick");

    cleanup();
    localStorage.setItem(storageKey, JSON.stringify({ puzzle_id: puzzle.puzzle_id, history: [played], selection: ["", "", "", ""] }));
    view = await renderLoaded(locale);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("02 restored open round with empty slots");

    cleanup();
    localStorage.clear();
    localStorage.setItem(storageKey, JSON.stringify({ puzzle_id: puzzle.puzzle_id, history: [played, secret], selection: ["", "", "", ""] }));
    serve();
    view = render(<CodeGroupsGame locale={locale} />);
    await screen.findByTestId("game-result");
    await settle();
    expect(capture(view.container)).toMatchSnapshot("03 restored win");

    cleanup();
    localStorage.clear();
    const lost = wrongGuesses(puzzle.max_attempts);
    localStorage.setItem(storageKey, JSON.stringify({ puzzle_id: puzzle.puzzle_id, history: lost, selection: ["", "", "", ""] }));
    serve();
    view = render(<CodeGroupsGame locale={locale} />);
    await screen.findByTestId("game-result");
    await settle();
    expect(capture(view.container)).toMatchSnapshot("04 restored loss");

    cleanup();
    localStorage.removeItem(storageKey);
    serve();
    view = render(<CodeGroupsGame locale={locale} />);
    await screen.findByTestId("daily-done");
    await settle();
    expect(capture(view.container)).toMatchSnapshot("05 day already recorded for a dropped save");
  });

  it("pins the raw save written after each step", async () => {
    await renderLoaded("pt-BR");
    const saves: Array<string | null> = [localStorage.getItem(storageKey)];
    selectSlot(0, secret[1]!);
    saves.push(localStorage.getItem(storageKey));
    guess("pt-BR", [secret[1]!, secret[0]!, unused[0]!, secret[3]!]);
    saves.push(localStorage.getItem(storageKey));
    send("pt-BR");
    saves.push(localStorage.getItem(storageKey));
    guess("pt-BR", secret);
    saves.push(localStorage.getItem(storageKey));
    expect(saves).toMatchSnapshot();
  });

  it("pins the share text of a win and a loss in both languages", () => {
    const won = [
      { ids: [secret[1]!, secret[0]!, unused[0]!, secret[3]!], exact: 1, misplaced: 2 },
      { ids: [...secret], exact: 4, misplaced: 0 },
    ];
    const lost = wrongGuesses(puzzle.max_attempts).map((ids) => {
      const exact = ids.filter((id, index) => id === secret[index]).length;
      return { ids, exact, misplaced: 4 - exact };
    });
    // Share snapshots use the first published daily date so the header carries #N.
    const dailyPuzzle = { ...puzzle, reference_date: "2026-10-19" };
    expect({
      wonPt: generateShareText(dailyPuzzle, won, "pt-BR"),
      wonEn: generateShareText(dailyPuzzle, won, "en"),
      lostPt: generateShareText(dailyPuzzle, lost, "pt-BR"),
      lostEn: generateShareText(dailyPuzzle, lost, "en"),
    }).toMatchSnapshot();
  });
});
