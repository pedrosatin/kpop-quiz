import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale, TimelinePuzzle } from "../../lib/quiz-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { onDay } from "../../test/stale-daily";
import { TimelineBoard } from "./TimelineBoard";
import { TimelineCard } from "./TimelineCard";
import { TimelineGame } from "./TimelineGame";
import { getCanonicalChronologicalOrder } from "./timeline-utils";

// Pins the rendered DOM, the focused element and the saved board of every
// timeline state, so splitting the board and the cards can be checked against
// the code it replaces.

const puzzle = fixture as unknown as TimelinePuzzle;
const storageKey = `kpop-timeline-${puzzle.puzzle_id}`;

const labels = {
  "pt-BR": { submit: "Verificar ordem", giveUp: "Desistir", confirmGiveUp: "Sim, desistir", up: "para cima", down: "para baixo" },
  en: { submit: "Check order", giveUp: "Give up", confirmGiveUp: "Yes, give up", up: "up", down: "down" },
} as const;

function describeFocus(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "body";
  const id = element.id ? `#${element.id}` : "";
  const name = element.getAttribute("aria-label") ?? element.textContent;
  return `${element.tagName.toLowerCase()}${id} ${JSON.stringify(name)}`;
}

/** The game as the player meets it: markup, focus and the saved board. */
function capture(container: Element) {
  const saved = localStorage.getItem(storageKey);
  return { html: container.innerHTML, focus: describeFocus(), saved: saved ? JSON.parse(saved) : null };
}

/** A drag payload that records what the board writes to it. */
function dataTransfer(from: number) {
  const writes: unknown[] = [];
  const dt = {
    _effectAllowed: "",
    _dropEffect: "",
    get effectAllowed() { return this._effectAllowed; },
    set effectAllowed(value: string) { writes.push(["effectAllowed", value]); this._effectAllowed = value; },
    get dropEffect() { return this._dropEffect; },
    set dropEffect(value: string) { writes.push(["dropEffect", value]); this._dropEffect = value; },
    setData: (type: string, value: string) => writes.push(["setData", type, value]),
    getData: (type: string) => {
      writes.push(["getData", type]);
      return String(from);
    },
  };
  return { dt, writes };
}

/** Enter on a button as a browser delivers it: keydown, then click unless prevented. */
function pressEnter(target: HTMLElement) {
  if (fireEvent.keyDown(target, { key: "Enter", code: "Enter" })) fireEvent.click(target);
}

const cards = () => screen.getAllByRole("listitem");
const cardIds = () => cards().map((card) => card.getAttribute("data-testid"));

function moveToSolution() {
  const canonical = getCanonicalChronologicalOrder(puzzle.events);
  for (const [target, event] of canonical.entries()) {
    let current = cardIds().indexOf(`timeline-card-${event.id}`);
    while (current > target) {
      fireEvent.click(document.getElementById(`timeline-move-up-${event.id}`)!);
      current--;
    }
  }
}

beforeEach(() => {
  localStorage.clear();
  onDay(puzzle.reference_date);
  vi.spyOn(performance, "now").mockReturnValue(1000);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("timeline characterization", () => {
  it.each(["pt-BR", "en"] as const)("renders the board, drag and keyboard states the same way in %s", (locale: Locale) => {
    const l = labels[locale];
    const first = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    expect(capture(first.container)).toMatchSnapshot("01 initial");

    const { dt, writes } = dataTransfer(3);
    fireEvent.dragStart(cards()[3]!, { dataTransfer: dt });
    expect(capture(first.container)).toMatchSnapshot("02 card selected");

    fireEvent.dragOver(cards()[1]!, { dataTransfer: dt });
    expect(capture(first.container)).toMatchSnapshot("03 dragging over another card");

    fireEvent.dragLeave(cards()[1]!, { dataTransfer: dt });
    expect(capture(first.container)).toMatchSnapshot("04 drag left the card");

    fireEvent.dragOver(cards()[1]!, { dataTransfer: dt });
    fireEvent.drop(cards()[1]!, { dataTransfer: dt });
    fireEvent.dragEnd(cards()[3]!, { dataTransfer: dt });
    expect(capture(first.container)).toMatchSnapshot("05 dropped");
    expect(writes).toMatchSnapshot("05 drag payload writes");

    const up = within(cards()[4]!).getByRole("button", { name: new RegExp(`${l.up}"?$`) });
    up.focus();
    pressEnter(up);
    expect(capture(first.container)).toMatchSnapshot("06 keyboard move up");

    const toTop = within(cards()[1]!).getByRole("button", { name: new RegExp(`${l.up}"?$`) });
    toTop.focus();
    pressEnter(toTop);
    expect(capture(first.container)).toMatchSnapshot("07 keyboard move to the top");

    const toBottom = within(cards()[3]!).getByRole("button", { name: new RegExp(`${l.down}"?$`) });
    toBottom.focus();
    pressEnter(toBottom);
    expect(capture(first.container)).toMatchSnapshot("08 keyboard move to the bottom");

    const repeated = within(cards()[2]!).getByRole("button", { name: new RegExp(`${l.down}"?$`) });
    expect(fireEvent.keyDown(repeated, { key: "Enter", code: "Enter", repeat: true })).toBe(false);
    first.unmount();

    const second = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    expect(capture(second.container)).toMatchSnapshot("09 draft restored");
  });

  it.each(["pt-BR", "en"] as const)("renders a wrong check and the restored loss the same way in %s", async (locale: Locale) => {
    const l = labels[locale];
    const first = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    fireEvent.click(within(cards()[4]!).getByRole("button", { name: new RegExp(`${l.up}"?$`) }));
    fireEvent.click(screen.getByRole("button", { name: l.submit }));
    await screen.findByTestId("game-result");
    expect(capture(first.container)).toMatchSnapshot("10 check wrong");
    first.unmount();

    const second = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    await screen.findByTestId("game-result");
    expect(capture(second.container)).toMatchSnapshot("11 loss restored");
  });

  it.each(["pt-BR", "en"] as const)("renders a right check and the restored win the same way in %s", async (locale: Locale) => {
    const l = labels[locale];
    const first = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    moveToSolution();
    expect(capture(first.container)).toMatchSnapshot("12 board in the right order");

    fireEvent.click(screen.getByRole("button", { name: l.submit }));
    await screen.findByTestId("game-result");
    expect(capture(first.container)).toMatchSnapshot("13 check right");
    first.unmount();

    const second = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    await screen.findByTestId("game-result");
    expect(capture(second.container)).toMatchSnapshot("14 win restored");
  });

  it.each(["pt-BR", "en"] as const)("renders the give-up confirmation and the defeat the same way in %s", async (locale: Locale) => {
    const l = labels[locale];
    const { container } = render(<TimelineGame locale={locale} puzzle={puzzle} />);
    const giveUp = screen.getByRole("button", { name: l.giveUp });
    giveUp.focus();
    fireEvent.click(giveUp);
    expect(capture(container)).toMatchSnapshot("15 give-up confirmation");

    fireEvent.click(screen.getByRole("button", { name: l.confirmGiveUp }));
    await screen.findByTestId("game-result");
    expect(capture(container)).toMatchSnapshot("16 gave up");
  });
});

describe("timeline board callbacks", () => {
  it("reports every move to its callbacks in the same order", () => {
    const calls: unknown[] = [];
    const record = (name: string) => (...args: unknown[]) => calls.push([name, ...args]);
    const { container } = render(
      <TimelineBoard
        events={puzzle.events}
        locale="pt-BR"
        onMoveUp={record("moveUp")}
        onMoveDown={record("moveDown")}
        onReorder={record("reorder")}
        onSubmit={record("submit")}
        onGiveUp={record("giveUp")}
      />,
    );

    fireEvent.click(document.getElementById(`timeline-move-up-${puzzle.events[2]!.id}`)!);
    fireEvent.click(document.getElementById(`timeline-move-down-${puzzle.events[0]!.id}`)!);
    fireEvent.click(document.getElementById(`timeline-move-up-${puzzle.events[0]!.id}`)!);
    // The top card cannot move up.
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: /para cima$/ }));

    const { dt, writes } = dataTransfer(4);
    fireEvent.dragStart(cards()[4]!, { dataTransfer: dt });
    fireEvent.dragOver(cards()[0]!, { dataTransfer: dt });
    fireEvent.drop(cards()[0]!, { dataTransfer: dt });
    fireEvent.dragEnd(cards()[4]!, { dataTransfer: dt });

    // A drop on the dragged card itself and one with an index off the board change nothing.
    const same = dataTransfer(2);
    fireEvent.dragStart(cards()[2]!, { dataTransfer: same.dt });
    fireEvent.drop(cards()[2]!, { dataTransfer: same.dt });
    const outside = dataTransfer(9);
    fireEvent.dragStart(cards()[1]!, { dataTransfer: outside.dt });
    fireEvent.drop(cards()[3]!, { dataTransfer: outside.dt });

    // Without a payload the drop falls back to the card where the drag started.
    const empty = { setData: () => undefined, getData: () => "" };
    fireEvent.dragStart(cards()[1]!, { dataTransfer: empty });
    fireEvent.drop(cards()[2]!, { dataTransfer: empty });

    fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
    expect({ calls, writes, order: cardIds(), html: container.innerHTML, focus: describeFocus() }).toMatchSnapshot();
  });

  it("keeps a submitted board inert and renders it the same way", () => {
    const calls: unknown[] = [];
    const record = (name: string) => (...args: unknown[]) => calls.push([name, ...args]);
    const { container } = render(
      <TimelineBoard
        events={puzzle.events}
        locale="en"
        gameStatus="submitted"
        onMoveUp={record("moveUp")}
        onMoveDown={record("moveDown")}
        onReorder={record("reorder")}
        onSubmit={record("submit")}
      />,
    );
    const { dt } = dataTransfer(3);
    fireEvent.dragStart(cards()[3]!, { dataTransfer: dt });
    fireEvent.dragOver(cards()[1]!, { dataTransfer: dt });
    fireEvent.drop(cards()[1]!, { dataTransfer: dt });
    fireEvent.click(document.getElementById(`timeline-move-up-${puzzle.events[2]!.id}`)!);
    expect({ calls, order: cardIds(), html: container.innerHTML }).toMatchSnapshot();
  });
});

describe("timeline card", () => {
  const event = puzzle.events[1]!;

  it.each([
    ["index-based limits at the top", { index: 0, totalEvents: 3 }],
    ["index-based limits at the bottom", { index: 2, totalEvents: 3 }],
    ["explicit limits", { index: 1, totalEvents: 3, canMoveUp: false, canMoveDown: true }],
    ["submitted", { index: 1, totalEvents: 3, gameStatus: "submitted" as const }],
    ["dragging over itself", { index: 1, totalEvents: 3, isDragging: true, isDragOver: true }],
    ["in English without messages", { index: 1, totalEvents: 3, locale: "en" as const }],
    ["with partial messages", { index: 1, totalEvents: 3, messages: { moveUp: (title: string) => `Subir ${title}` } }],
  ])("renders %s the same way", (_name, props) => {
    const { container } = render(<ul><TimelineCard event={event} {...props} /></ul>);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("falls back to the Portuguese title, then the entity, and drops an empty description", () => {
    const bare = {
      ...event,
      title: { "pt-BR": "", en: "" },
      description: { "pt-BR": "", en: "" },
    };
    const portuguese = { ...event, title: { "pt-BR": "Só em português", en: "" }, description: { "pt-BR": "Descrição", en: "" } };
    const { container } = render(
      <ul>
        <TimelineCard event={bare} index={0} totalEvents={2} locale="en" />
        <TimelineCard event={portuguese} index={1} totalEvents={2} locale="en" />
      </ul>,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("forwards drag and move events with its index until the board is submitted", () => {
    const calls: unknown[] = [];
    const record = (name: string) => (...args: unknown[]) => calls.push([name, ...args.filter((arg) => typeof arg === "number")]);
    const handlers = {
      onMoveUp: record("moveUp"),
      onMoveDown: record("moveDown"),
      onDragStart: record("dragStart"),
      onDragOver: record("dragOver"),
      onDragLeave: record("dragLeave"),
      onDrop: record("drop"),
      onDragEnd: record("dragEnd"),
    };
    const fire = () => {
      const card = screen.getByRole("listitem");
      fireEvent.dragStart(card);
      fireEvent.dragOver(card);
      fireEvent.dragLeave(card);
      fireEvent.drop(card);
      fireEvent.dragEnd(card);
      fireEvent.click(document.getElementById(`timeline-move-up-${event.id}`)!);
      fireEvent.click(document.getElementById(`timeline-move-down-${event.id}`)!);
    };

    const playing = render(<ul><TimelineCard event={event} index={1} totalEvents={3} {...handlers} /></ul>);
    fire();
    playing.unmount();
    calls.push("submitted");
    render(<ul><TimelineCard event={event} index={1} totalEvents={3} gameStatus="submitted" {...handlers} /></ul>);
    fire();
    expect(calls).toMatchSnapshot();
  });
});
