import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "../../i18n/catalog";
import type { TimelinePuzzle } from "../../lib/quiz-types";
import { loadPlayerStats, markGameMatchRecorded } from "../../lib/player-stats";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { TimelineGame } from "./TimelineGame";
import { calculateScore, getCanonicalChronologicalOrder } from "./timeline-utils";

const puzzle = fixture as unknown as TimelinePuzzle;
const pt = getMessages("pt-BR");

describe("TimelineGame", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders loading state with QuizState while loading", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(<TimelineGame locale="pt-BR" />);
    const timeline = document.getElementById("timeline");
    expect(timeline).toBeInTheDocument();
    expect(within(timeline!).getByText(pt.loading)).toBeInTheDocument();
    expect(timeline!.querySelector(".loader")).toBeInTheDocument();
  });

  it("renders missing error and retries loading when clicking retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(puzzle)));
    vi.stubGlobal("fetch", fetchMock);

    render(<TimelineGame locale="pt-BR" />);
    expect(await screen.findByText(pt.artifactMissing)).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: pt.retry });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(await screen.findByRole("button", { name: "Verificar ordem" })).toBeInTheDocument();
  });

  it("renders general load error on invalid response and retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("invalid json", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(puzzle)));
    vi.stubGlobal("fetch", fetchMock);

    render(<TimelineGame locale="pt-BR" />);
    expect(await screen.findByText(pt.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: pt.retry }));
    expect(await screen.findByRole("button", { name: "Verificar ordem" })).toBeInTheDocument();
  });

  it("renders board and controls with puzzle prop in pt-BR and en", () => {
    const { unmount } = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    expect(document.getElementById("timeline")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Verificar ordem" })).toBeInTheDocument();

    unmount();
    render(<TimelineGame locale="en" puzzle={puzzle} />);
    expect(screen.getByRole("button", { name: "Check order" })).toBeInTheDocument();
  });

  it("moves cards and transitions to TimelineResults on submit", async () => {
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    const cards = screen.getAllByRole("listitem");
    const secondTitle = puzzle.events[1]!.title["pt-BR"];
    const upBtn = within(cards[1]!).getByRole("button", { name: `Mover "${secondTitle}" para cima` });

    fireEvent.click(upBtn);
    const reordered = screen.getAllByRole("listitem");
    expect(within(reordered[0]!).getByText(secondTitle)).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: "Verificar ordem" });
    fireEvent.click(submitBtn);

    const heading = await screen.findByRole("heading", { name: /Pontuação:/ });
    expect(heading).toBeInTheDocument();
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole("button", { name: "Compartilhar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verificar ordem" })).not.toBeInTheDocument();
  });

  it("counts a puzzle finished in this visit once", async () => {
    const { unmount } = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
    await screen.findByRole("heading", { name: /Pontuação:/ });
    expect(loadPlayerStats().games.timeline?.played).toBe(1);

    unmount();
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await screen.findByRole("heading", { name: /Pontuação:/ });
    expect(loadPlayerStats().games.timeline?.played).toBe(1);
  });

  it("does not count a restored puzzle whose finish was already recorded", async () => {
    markGameMatchRecorded("timeline", `timeline-${puzzle.puzzle_id}`);
    const canonical = getCanonicalChronologicalOrder(puzzle.events);
    const evaluated = calculateScore(canonical, canonical);
    localStorage.setItem(
      `kpop-timeline-${puzzle.puzzle_id}`,
      JSON.stringify({
        puzzleId: puzzle.puzzle_id,
        referenceDate: puzzle.reference_date,
        orderedEventIds: canonical.map((event) => event.id),
        submitted: true,
        score: evaluated.score,
        results: evaluated.results,
      }),
    );
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);

    await screen.findByRole("heading", { name: /Pontuação:/ });
    expect(loadPlayerStats().games.timeline?.played ?? 0).toBe(0);
  });

  it("records a partial-score submit as played without a win", async () => {
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    const cards = screen.getAllByRole("listitem");
    const secondTitle = puzzle.events[1]!.title["pt-BR"];
    const upBtn = within(cards[1]!).getByRole("button", { name: `Mover "${secondTitle}" para cima` });
    fireEvent.click(upBtn);

    fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
    await screen.findByRole("heading", { name: /Pontuação:/ });

    expect(loadPlayerStats().games.timeline?.played).toBe(1);
    expect(loadPlayerStats().games.timeline?.won).toBe(0);
  });

  it("records a win when submitting the canonical order", async () => {
    // The fixture may already be chronological, so shuffle first to prove
    // the sorted puzzle wins on an untouched submit.
    const shuffled = [...puzzle.events].reverse();
    const sortedPuzzle = {
      ...puzzle,
      events: getCanonicalChronologicalOrder(shuffled),
    } as TimelinePuzzle;
    render(<TimelineGame locale="pt-BR" puzzle={sortedPuzzle} />);

    fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
    await screen.findByRole("heading", { name: /Pontuação:/ });

    expect(loadPlayerStats().games.timeline?.played).toBe(1);
    expect(loadPlayerStats().games.timeline?.won).toBe(1);
  });

  it("submits on give-up and reveals the canonical order", async () => {
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));

    const heading = await screen.findByRole("heading", { name: /Pontuação:/ });
    expect(heading).toBeInTheDocument();
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole("button", { name: "Desistir" })).not.toBeInTheDocument();

    const canonical = getCanonicalChronologicalOrder(puzzle.events);
    const items = [...document.querySelectorAll(".timeline-results-list > li")];
    expect(items).toHaveLength(canonical.length);
    for (const [index, event] of canonical.entries()) {
      expect(items[index]!.textContent).toContain(event.title["pt-BR"]);
    }
  });

  it("records a give-up on the canonical order as played without a win", async () => {
    const shuffled = [...puzzle.events].reverse();
    const sortedPuzzle = {
      ...puzzle,
      events: getCanonicalChronologicalOrder(shuffled),
    } as TimelinePuzzle;
    render(<TimelineGame locale="pt-BR" puzzle={sortedPuzzle} />);

    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    await screen.findByRole("heading", { name: /Pontuação:/ });

    expect(loadPlayerStats().games.timeline?.played).toBe(1);
    expect(loadPlayerStats().games.timeline?.won ?? 0).toBe(0);
  });

  it("has zero accessibility violations with axe-core in playing and submitted states", async () => {
    const { container } = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    expect((await axe.run(container)).violations).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
    await screen.findByRole("heading", { name: /Pontuação:/ });
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
