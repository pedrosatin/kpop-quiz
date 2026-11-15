import { describe, expect, it } from "vitest";
import type { TimelinePuzzle } from "../../lib/quiz-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import {
  buttonMoveTarget,
  cardMoveLimits,
  dropSourceIndex,
  focusAfterMoveId,
  isBoardIndex,
  moveItem,
  swapItems,
  timelineBoardMessages,
  timelineCardClass,
  timelineCardMoveLabels,
  timelineEventDescription,
  timelineEventTitle,
} from "./timeline-board-state";
import { DEFAULT_TIMELINE_MESSAGES } from "./types";

const event = (fixture as unknown as TimelinePuzzle).events[0]!;

describe("timelineEventTitle and timelineEventDescription", () => {
  it("use the locale, then Portuguese, then the entity name or nothing", () => {
    expect(timelineEventTitle(event, "en")).toBe(event.title.en);
    const portuguese = { ...event, title: { "pt-BR": "Título", en: "" }, description: { "pt-BR": "Texto", en: "" } };
    expect(timelineEventTitle(portuguese, "en")).toBe("Título");
    expect(timelineEventDescription(portuguese, "en")).toBe("Texto");
    const bare = { ...event, title: { "pt-BR": "", en: "" }, description: { "pt-BR": "", en: "" } };
    expect(timelineEventTitle(bare, "en")).toBe(event.entity_name);
    expect(timelineEventDescription(bare, "en")).toBe("");
  });
});

describe("timelineBoardMessages and timelineCardMoveLabels", () => {
  it("put each custom message over the built-in copy of the locale", () => {
    const itemMoved = () => "moved";
    const messages = timelineBoardMessages("en", { itemMoved });
    expect(messages.itemMoved).toBe(itemMoved);
    expect(messages.boardAria).toBe(DEFAULT_TIMELINE_MESSAGES.en.boardAria);

    const moveUp = (title: string) => `Up ${title}`;
    const labels = timelineCardMoveLabels("pt-BR", { moveUp });
    expect(labels.moveUp).toBe(moveUp);
    expect(labels.moveDown).toBe(DEFAULT_TIMELINE_MESSAGES["pt-BR"].moveDown);
  });
});

describe("isBoardIndex", () => {
  it("accepts only an index of a card on the board", () => {
    expect(isBoardIndex(0, 3)).toBe(true);
    expect(isBoardIndex(2, 3)).toBe(true);
    expect(isBoardIndex(3, 3)).toBe(false);
    expect(isBoardIndex(-1, 3)).toBe(false);
    expect(isBoardIndex(NaN, 3)).toBe(false);
  });
});

describe("buttonMoveTarget", () => {
  it("moves one place up or down, and refuses a move past an end", () => {
    expect(buttonMoveTarget(1, "up", 3)).toBe(0);
    expect(buttonMoveTarget(1, "down", 3)).toBe(2);
    expect(buttonMoveTarget(0, "up", 3)).toBeNull();
    expect(buttonMoveTarget(2, "down", 3)).toBeNull();
    expect(buttonMoveTarget(3, "up", 3)).toBeNull();
    expect(buttonMoveTarget(-1, "down", 3)).toBeNull();
  });
});

describe("swapItems and moveItem", () => {
  it("swap two items in a copy", () => {
    const items = ["a", "b", "c"];
    expect(swapItems(items, 0, 2)).toEqual(["c", "b", "a"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("move one item to another place in a copy, or return the list when the place is empty", () => {
    const items = ["a", "b", "c", "d"];
    expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(items, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(items, 9, 0)).toBe(items);
  });
});

describe("dropSourceIndex", () => {
  it("reads the payload, and falls back to the card where the drag started", () => {
    expect(dropSourceIndex("3", 1)).toBe(3);
    expect(dropSourceIndex("", 1)).toBe(1);
    expect(dropSourceIndex(undefined, null)).toBeNull();
    expect(dropSourceIndex("x", 1)).toBeNaN();
  });
});

describe("focusAfterMoveId", () => {
  it("keeps the button that moved the card, unless the card reached an end", () => {
    expect(focusAfterMoveId("e", 1, 3, "up")).toBe("timeline-move-up-e");
    expect(focusAfterMoveId("e", 1, 3, "down")).toBe("timeline-move-down-e");
    expect(focusAfterMoveId("e", 0, 3, "up")).toBe("timeline-move-down-e");
    expect(focusAfterMoveId("e", 2, 3, "down")).toBe("timeline-move-up-e");
  });
});

describe("cardMoveLimits", () => {
  const base = { index: 1, totalEvents: 3, isSubmitted: false, canMoveUp: undefined, canMoveDown: undefined };

  it("uses the card's index when the board gives no limits", () => {
    expect(cardMoveLimits(base)).toEqual({ upDisabled: false, downDisabled: false });
    expect(cardMoveLimits({ ...base, index: 0 })).toEqual({ upDisabled: true, downDisabled: false });
    expect(cardMoveLimits({ ...base, index: 2 })).toEqual({ upDisabled: false, downDisabled: true });
  });

  it("lets explicit limits win over the index, and a submitted board over both", () => {
    expect(cardMoveLimits({ ...base, index: 0, canMoveUp: true, canMoveDown: false })).toEqual({ upDisabled: false, downDisabled: true });
    expect(cardMoveLimits({ ...base, isSubmitted: true, canMoveUp: true, canMoveDown: true })).toEqual({ upDisabled: true, downDisabled: true });
  });
});

describe("timelineCardClass", () => {
  it("adds one class for each drag and submit state", () => {
    expect(timelineCardClass(false, false, false)).toBe("timeline-card");
    expect(timelineCardClass(true, true, true)).toBe("timeline-card is-dragging is-drag-over is-submitted");
    expect(timelineCardClass(false, true, false)).toBe("timeline-card is-drag-over");
  });
});
