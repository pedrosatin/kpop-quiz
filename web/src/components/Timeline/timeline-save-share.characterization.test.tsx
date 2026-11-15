import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale, TimelinePuzzle } from "../../lib/quiz-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { calculateScore, getCanonicalChronologicalOrder, loadTimelineSavedState } from "./timeline-utils";
import { RESULT_GUARD_MS, TimelineShare } from "./TimelineShare";

// Pins which submitted saves the board restores and how the share button
// renders after a copy and after a failure, before both are split.

const puzzle = fixture as unknown as TimelinePuzzle;
const key = `kpop-timeline-${puzzle.puzzle_id}`;
const canonical = getCanonicalChronologicalOrder(puzzle.events);
const ids = canonical.map((event) => event.id);
const evaluated = calculateScore(canonical, canonical);

const valid = {
  puzzleId: puzzle.puzzle_id,
  referenceDate: puzzle.reference_date,
  orderedEventIds: ids,
  submitted: true,
  score: evaluated.score,
  results: evaluated.results,
};

function load(save: unknown, storageKey = key) {
  localStorage.setItem(key, typeof save === "string" ? save : JSON.stringify(save));
  return loadTimelineSavedState(storageKey, puzzle);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadTimelineSavedState characterization", () => {
  it("restores a valid save with only its known fields and gaveUp as a boolean", () => {
    expect(load({ ...valid, extra: 1 })).toStrictEqual({ ...valid, gaveUp: false });
    expect(load({ ...valid, gaveUp: true })).toStrictEqual({ ...valid, gaveUp: true });
    expect(load({ ...valid, gaveUp: false })).toStrictEqual({ ...valid, gaveUp: false });
  });

  it.each([
    ["an empty storage key", valid, ""],
    ["malformed JSON", "{", key],
    ["JSON null", "null", key],
    ["a JSON array", "[]", key],
    ["a JSON string", '"text"', key],
  ])("refuses %s", (_name, save, storageKey) => {
    expect(load(save, storageKey)).toBeNull();
  });

  it("refuses an absent save", () => {
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();
  });

  it.each([
    ["another puzzle", { puzzleId: "other" }],
    ["another date", { referenceDate: "2099-01-01" }],
    ["a draft", { submitted: false }],
    ["a submitted flag that is not a boolean", { submitted: "true" }],
    ["a missing submitted flag", { submitted: undefined }],
    ["a gaveUp that is not a boolean", { gaveUp: "yes" }],
    ["a gaveUp of null", { gaveUp: null }],
    ["a score that is a string", { score: "5" }],
    ["a fractional score", { score: 4.5 }],
    ["a negative score", { score: -1 }],
    ["results that are not a list", { results: "true" }],
    ["results with a non-boolean", { results: [true, true, true, true, 1] }],
    ["an order missing an event", { orderedEventIds: ids.slice(1) }],
    ["an order with a repeated event", { orderedEventIds: [ids[0], ...ids.slice(0, -1)] }],
    ["an order with an unknown event", { orderedEventIds: ["unknown", ...ids.slice(1)] }],
    ["a score that does not match the order", { score: 4 }],
    ["results that do not match the order", { results: [false, true, true, true, true] }],
    ["results shorter than the order", { score: 4, results: [true, true, true, true] }],
  ])("refuses %s", (_name, change) => {
    expect(load({ ...valid, ...change })).toBeNull();
  });
});

describe("TimelineShare characterization", () => {
  let clock = 1000;

  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  async function share(name: string) {
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name }));
  }

  it.each([
    ["pt-BR", "Compartilhar"],
    ["en", "Share"],
  ] as const)("renders the copied and failed states the same way in %s", async (locale: Locale, button) => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Denied")).mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = render(<TimelineShare shareText={"text\nurl"} locale={locale} />);
    expect(container.innerHTML).toMatchSnapshot("initial");

    await share(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector(".timeline-share-live span")?.textContent).not.toBe(""));
    expect(container.innerHTML).toMatchSnapshot("copied");

    await share(button);
    await screen.findByRole("textbox");
    expect(container.innerHTML).toMatchSnapshot("failed");

    await share(button);
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(container.innerHTML).toMatchSnapshot("copied after a failure");
  });

  it("uses custom messages over the defaults", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
    const messages = { share: "Enviar", shareFailed: "Falhou", shareTextLabel: "Texto" };
    const { container } = render(<TimelineShare shareText="text" locale="en" messages={messages} />);
    await share("Enviar");
    await screen.findByRole("textbox");
    expect(container.innerHTML).toMatchSnapshot();
  });
});
