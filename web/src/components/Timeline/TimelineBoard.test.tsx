import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePuzzle } from "../../lib/timeline-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { TimelineBoard } from "./TimelineBoard";

const puzzle = fixture as unknown as TimelinePuzzle;
const events = puzzle.events;

function pressKey(target: HTMLElement, key: "Enter" | " ", repeat = false) {
  const code = key === "Enter" ? "Enter" : "Space";
  if (fireEvent.keyDown(target, { key, code, repeat })) {
    fireEvent.click(target);
  }
}

describe("TimelineBoard", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders 5 cards with titles and descriptions in PT-BR and EN", () => {
    const { unmount } = render(<TimelineBoard events={events} locale="pt-BR" />);
    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);

    events.forEach((event, i) => {
      expect(within(items[i]!).getByText(`#${i + 1}`)).toBeInTheDocument();
      expect(within(items[i]!).getByText(event.title["pt-BR"])).toBeInTheDocument();
      expect(within(items[i]!).getByText(event.description["pt-BR"])).toBeInTheDocument();
    });

    unmount();
    render(<TimelineBoard events={events} locale="en" />);
    const enItems = screen.getAllByRole("listitem");
    events.forEach((event, i) => {
      expect(within(enItems[i]!).getByText(event.title.en)).toBeInTheDocument();
      expect(within(enItems[i]!).getByText(event.description.en)).toBeInTheDocument();
    });
  });

  it("swaps card with predecessor on Move Up and updates live announcement", () => {
    render(<TimelineBoard events={events} locale="pt-BR" />);
    const cards = screen.getAllByRole("listitem");
    const secondTitle = events[1]!.title["pt-BR"];
    const upBtn = within(cards[1]!).getByRole("button", { name: `Mover "${secondTitle}" para cima` });

    fireEvent.click(upBtn);

    const reordered = screen.getAllByRole("listitem");
    expect(within(reordered[0]!).getByText(secondTitle)).toBeInTheDocument();
    expect(within(reordered[1]!).getByText(events[0]!.title["pt-BR"])).toBeInTheDocument();

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(`${secondTitle} movido para a posição 1 de 5`);
  });

  it("swaps card with successor on Move Down and updates live announcement", () => {
    render(<TimelineBoard events={events} locale="pt-BR" />);
    const cards = screen.getAllByRole("listitem");
    const secondTitle = events[1]!.title["pt-BR"];
    const downBtn = within(cards[1]!).getByRole("button", { name: `Mover "${secondTitle}" para baixo` });

    fireEvent.click(downBtn);

    const reordered = screen.getAllByRole("listitem");
    expect(within(reordered[2]!).getByText(secondTitle)).toBeInTheDocument();
    expect(within(reordered[1]!).getByText(events[2]!.title["pt-BR"])).toBeInTheDocument();

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(`${secondTitle} movido para a posição 3 de 5`);
  });

  it("disables Move Up on top card and Move Down on bottom card", () => {
    render(<TimelineBoard events={events} locale="pt-BR" />);
    const cards = screen.getAllByRole("listitem");

    expect(within(cards[0]!).getByRole("button", { name: /para cima/ })).toBeDisabled();
    expect(within(cards[0]!).getByRole("button", { name: /para baixo/ })).toBeEnabled();

    expect(within(cards[4]!).getByRole("button", { name: /para cima/ })).toBeEnabled();
    expect(within(cards[4]!).getByRole("button", { name: /para baixo/ })).toBeDisabled();

    expect(within(cards[2]!).getByRole("button", { name: /para cima/ })).toBeEnabled();
    expect(within(cards[2]!).getByRole("button", { name: /para baixo/ })).toBeEnabled();
  });

  it("restores focus after moving cards up and down and clears lastMoved", () => {
    const { rerender } = render(<TimelineBoard events={events} locale="pt-BR" />);
    const cards = screen.getAllByRole("listitem");

    // Move card 1 up to index 0: focus moves to Move Down button (Move Up is disabled at index 0)
    const card1Up = within(cards[1]!).getByRole("button", { name: /para cima/ });
    fireEvent.click(card1Up);
    const downBtn0 = document.getElementById(`timeline-move-down-${events[1]!.id}`);
    expect(document.activeElement).toBe(downBtn0);

    // Move card at index 0 down to index 1: focus moves to Move Down button
    fireEvent.click(downBtn0!);
    const downBtn1 = document.getElementById(`timeline-move-down-${events[1]!.id}`);
    expect(document.activeElement).toBe(downBtn1);

    // Move card at index 3 down to index 4: focus moves to Move Up button (Move Down is disabled at bottom)
    const card3Down = document.getElementById(`timeline-move-down-${events[3]!.id}`);
    fireEvent.click(card3Down!);
    const upBtn4 = document.getElementById(`timeline-move-up-${events[3]!.id}`);
    expect(document.activeElement).toBe(upBtn4);

    // Move card at index 2 up to index 1: focus moves to Move Up button
    const card2Up = document.getElementById(`timeline-move-up-${events[2]!.id}`);
    fireEvent.click(card2Up!);
    const upBtn1 = document.getElementById(`timeline-move-up-${events[2]!.id}`);
    expect(document.activeElement).toBe(upBtn1);

    // Ensure lastMoved was cleared so rerender or prop updates do not steal focus
    const customButton = document.createElement("button");
    document.body.appendChild(customButton);
    customButton.focus();
    expect(document.activeElement).toBe(customButton);

    rerender(<TimelineBoard events={events} locale="pt-BR" />);
    expect(document.activeElement).toBe(customButton);
    document.body.removeChild(customButton);
  });

  it("invokes onMoveUp, onMoveDown, and onReorder callbacks when reordering", () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const onReorder = vi.fn();

    render(
      <TimelineBoard
        events={events}
        locale="pt-BR"
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onReorder={onReorder}
      />
    );

    const cards = screen.getAllByRole("listitem");
    const upBtn = within(cards[2]!).getByRole("button", { name: /para cima/ });
    fireEvent.click(upBtn);

    expect(onMoveUp).toHaveBeenCalledWith(2);
    expect(onReorder).toHaveBeenCalledWith(2, 1);

    const downBtn = within(screen.getAllByRole("listitem")[1]!).getByRole("button", { name: /para baixo/ });
    fireEvent.click(downBtn);

    expect(onMoveDown).toHaveBeenCalledWith(1);
    expect(onReorder).toHaveBeenCalledWith(1, 2);

    const currentCards = screen.getAllByRole("listitem");
    const dt = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("4"),
    };

    fireEvent.dragStart(currentCards[4]!, { dataTransfer: dt });
    fireEvent.dragOver(currentCards[0]!, { dataTransfer: dt });
    fireEvent.drop(currentCards[0]!, { dataTransfer: dt });
    fireEvent.dragEnd(currentCards[4]!);

    expect(onReorder).toHaveBeenCalledWith(4, 0);
  });

  it("drag and drop reorders items and updates live announcement", () => {
    render(<TimelineBoard events={events} locale="pt-BR" />);
    const cards = screen.getAllByRole("listitem");
    const draggedTitle = events[3]!.title["pt-BR"];
    const dt = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("3"),
    };

    fireEvent.dragStart(cards[3]!, { dataTransfer: dt });
    fireEvent.dragOver(cards[1]!, { dataTransfer: dt });
    fireEvent.drop(cards[1]!, { dataTransfer: dt });
    fireEvent.dragEnd(cards[3]!);

    const reordered = screen.getAllByRole("listitem");
    expect(within(reordered[1]!).getByText(draggedTitle)).toBeInTheDocument();

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(`${draggedTitle} movido para a posição 2 de 5`);
  });

  it("disables submit button and locks duplicate clicks on submit", () => {
    const onSubmit = vi.fn();
    render(<TimelineBoard events={events} locale="pt-BR" onSubmit={onSubmit} />);
    const submitBtn = screen.getByRole("button", { name: "Verificar ordem" });
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitBtn).toBeDisabled();

    vi.spyOn(performance, "now").mockReturnValue(1100);
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    vi.spyOn(performance, "now").mockReturnValue(1500);
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables reorder buttons and drag handles when gameStatus is submitted", () => {
    render(<TimelineBoard events={events} locale="pt-BR" gameStatus="submitted" onSubmit={vi.fn()} />);
    screen.getAllByRole("listitem").forEach((card) => {
      expect(card).toHaveAttribute("draggable", "false");
      expect(within(card).getByRole("button", { name: /para cima/ })).toBeDisabled();
      expect(within(card).getByRole("button", { name: /para baixo/ })).toBeDisabled();
      const handle = card.querySelector(".timeline-drag-handle");
      expect(handle).not.toHaveAttribute("aria-disabled");
      expect(handle).toHaveClass("is-disabled");
      expect(handle).toHaveAttribute("aria-hidden", "true");
    });
    expect(screen.getByRole("button", { name: "Verificar ordem" })).toBeDisabled();
  });

  it("activates reorder and submit buttons with Enter and Space", () => {
    const onSubmit = vi.fn();
    render(<TimelineBoard events={events} locale="pt-BR" onSubmit={onSubmit} />);
    const cards = screen.getAllByRole("listitem");

    const upBtn = within(cards[1]!).getByRole("button", { name: /para cima/ });
    upBtn.focus();
    expect(document.activeElement).toBe(upBtn);

    // Held key / repeat is prevented
    expect(fireEvent.keyDown(upBtn, { key: "Enter", repeat: true })).toBe(false);

    pressKey(upBtn, "Enter");
    expect(within(screen.getAllByRole("listitem")[0]!).getByText(events[1]!.title["pt-BR"])).toBeInTheDocument();

    const downBtn = within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: /para baixo/ });
    downBtn.focus();
    expect(fireEvent.keyDown(downBtn, { key: " ", repeat: true })).toBe(false);

    pressKey(downBtn, " ");
    expect(within(screen.getAllByRole("listitem")[1]!).getByText(events[1]!.title["pt-BR"])).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: "Verificar ordem" });
    submitBtn.focus();
    expect(fireEvent.keyDown(submitBtn, { key: "Enter", repeat: true })).toBe(false);

    pressKey(submitBtn, "Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("has no axe accessibility violations", async () => {
    const { container } = render(
      <TimelineBoard events={events} locale="pt-BR" onSubmit={vi.fn()} />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
