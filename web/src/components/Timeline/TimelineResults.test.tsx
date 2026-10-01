import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePuzzle } from "../../lib/timeline-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { getCanonicalChronologicalOrder } from "./timeline-utils";
import { TimelineResults } from "./TimelineResults";
import { RESULT_GUARD_MS, TimelineShare } from "./TimelineShare";

const puzzle = fixture as unknown as TimelinePuzzle;
const canonicalEvents = getCanonicalChronologicalOrder(puzzle.events);
const sampleShareText = "K-pop Quiz • Linha do Tempo 2026-09-30\nPontuação: 3/5 ⭐️\n🟩 🟥 🟩 🟥 🟩\nhttps://kpopquiz.online/";

describe("TimelineResults", () => {
  let clock = 1000;

  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders results banner, revealed dates, and fallback titles", () => {
    const customEvents = [
      { ...canonicalEvents[0]!, title: { "pt-BR": "", en: "" } },
      canonicalEvents[1]!,
    ];
    const { unmount } = render(
      <TimelineResults score={3} totalEvents={5} canonicalEvents={customEvents} results={[true, false]} shareText={sampleShareText} locale="pt-BR" />
    );
    expect(screen.getByText("Pontuação: 3/5 ⭐️")).toBeInTheDocument();
    expect(within(screen.getAllByRole("list")[0]!).getByText(customEvents[0]!.entity_name)).toBeInTheDocument();
    expect(screen.getAllByRole("list")[0]).toHaveAttribute("role", "list");

    unmount();
    render(
      <TimelineResults score={3} totalEvents={5} canonicalEvents={canonicalEvents} results={[true, false, true, false, true]} shareText={sampleShareText} locale="en" />
    );
    expect(screen.getByText("Score: 3/5 ⭐️")).toBeInTheDocument();
    expect(screen.getByText(canonicalEvents[0]!.display_date.en)).toBeInTheDocument();
    expect(within(screen.getAllByRole("list")[0]!).getByText(canonicalEvents[0]!.title.en)).toBeInTheDocument();
  });

  it("renders accuracy indicators per position", () => {
    render(<TimelineResults score={3} totalEvents={5} canonicalEvents={canonicalEvents} results={[true, false, true, false, true]} shareText={sampleShareText} locale="pt-BR" />);
    expect(screen.getAllByText("🟩")).toHaveLength(3);
    expect(screen.getAllByText("🟥")).toHaveLength(2);
    expect(screen.getAllByLabelText(/Posição correta/)).toHaveLength(3);
    expect(screen.getAllByLabelText(/Posição incorreta/)).toHaveLength(2);
  });

  it("displays sources panel with sanitization for external links", () => {
    const eventWithInvalidUrl = {
      ...canonicalEvents[0]!,
      evidence: [
        { fact_base_id: "fb-1", source_key: "safe", revision_id: 1, source_url: "https://example.com", locator: "p. 1" },
        { fact_base_id: "fb-2", source_key: "unsafe", revision_id: 2, source_url: "javascript:void(0)", locator: "p. 2" },
      ],
    };
    render(<TimelineResults score={3} totalEvents={5} canonicalEvents={[eventWithInvalidUrl]} results={[true]} shareText={sampleShareText} locale="pt-BR" />);
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute("href", "https://example.com");
    expect(screen.queryByRole("link", { name: "unsafe" })).not.toBeInTheDocument();
    expect(screen.getByText("unsafe")).toBeInTheDocument();
  });

  it("calls navigator.share when available and invokes onShareSuccess", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const onShareSuccess = vi.fn();
    vi.stubGlobal("navigator", { share: shareMock });
    render(<TimelineShare shareText={sampleShareText} locale="pt-BR" onShareSuccess={onShareSuccess} />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(shareMock).toHaveBeenCalledWith({ text: sampleShareText }));
    expect(onShareSuccess).toHaveBeenCalledTimes(1);
  });

  it("handles AbortError without displaying share error", async () => {
    const shareMock = vi.fn().mockRejectedValue(new DOMException("Abort", "AbortError"));
    vi.stubGlobal("navigator", { share: shareMock });
    render(<TimelineShare shareText={sampleShareText} locale="pt-BR" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Não deu para copiar/)).not.toBeInTheDocument();
  });

  it("falls back to navigator.clipboard.writeText when navigator.share throws non-abort error", async () => {
    const notAllowedError = new DOMException("Permission denied", "NotAllowedError");
    const shareMock = vi.fn().mockRejectedValue(notAllowedError);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: shareMock, clipboard: { writeText } });
    render(<TimelineShare shareText={sampleShareText} locale="pt-BR" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(shareMock).toHaveBeenCalledWith({ text: sampleShareText }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sampleShareText));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copiado para a área de transferência!"));
  });

  it("falls back to navigator.clipboard.writeText when navigator.share is undefined", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TimelineShare shareText={sampleShareText} locale="pt-BR" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sampleShareText));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copiado para a área de transferência!"));
  });

  it("renders manual copy textarea when clipboard fails and calls onShareError", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Denied"));
    const onShareError = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TimelineShare shareText={sampleShareText} locale="pt-BR" onShareError={onShareError} />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    const textarea = await screen.findByRole("textbox");
    expect(textarea).toHaveValue(sampleShareText);
    expect(onShareError).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Não deu para copiar. Selecione o texto abaixo e copie.", { selector: "p" })).toBeInTheDocument();
  });

  it("announces failure message in aria-live region when clipboard fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { unmount } = render(<TimelineShare shareText={sampleShareText} locale="pt-BR" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Não deu para copiar. Selecione o texto abaixo e copie."));

    unmount();
    render(<TimelineShare shareText={sampleShareText} locale="en" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not copy. Select the text below and copy it."));
  });

  it("announces copy success in aria-live region and updates key on repeated copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TimelineShare shareText={sampleShareText} locale="pt-BR" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copiado para a área de transferência!"));
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copiado para a área de transferência!"));
  });

  it("has zero accessibility violations with axe-core", async () => {
    const { container, unmount } = render(
      <TimelineResults score={3} totalEvents={5} canonicalEvents={canonicalEvents} results={[true, false, true, false, true]} shareText={sampleShareText} locale="pt-BR" />
    );
    expect((await axe.run(container)).violations).toEqual([]);

    unmount();
    const writeText = vi.fn().mockRejectedValue(new Error("Denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container: fallbackContainer } = render(<TimelineShare shareText={sampleShareText} locale="pt-BR" />);
    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await screen.findByRole("textbox");
    expect((await axe.run(fallbackContainer)).violations).toEqual([]);
  });
});
