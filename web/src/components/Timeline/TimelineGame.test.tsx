import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "../../i18n/catalog";
import type { TimelinePuzzle } from "../../lib/quiz-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { TimelineGame } from "./TimelineGame";

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

  it("has zero accessibility violations with axe-core in playing and submitted states", async () => {
    const { container } = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    expect((await axe.run(container)).violations).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
    await screen.findByRole("heading", { name: /Pontuação:/ });
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
