import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEvidence, Quiz } from "./Quiz";
import ptSession from "../../../public/data/session.pt-BR.8d417106807a63a77b82e4ffa067fa49c4b5318f3f0f13633622c30dc2ec0461.json";
import enSession from "../../../public/data/session.en.4c237c135056ebeca531204cfe59a86ef01a8a761552dba08b01c1eb128950c3.json";
import manifest from "../../../public/data/manifest.json";

function mockSessionFetch() {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const payload = url.endsWith("manifest.json") ? manifest : url.includes("pt-BR") ? ptSession : enSession;
    return Promise.resolve(new Response(`${JSON.stringify(payload)}${url.endsWith("manifest.json") ? "" : "\n"}`));
  }));
}

async function renderReady(locale: "pt-BR" | "en" = "pt-BR") {
  mockSessionFetch();
  render(<Quiz locale={locale} />);
  expect(screen.getByText(/Preparando|Preparing/)).toBeInTheDocument();
  const session = locale === "pt-BR" ? ptSession : enSession;
  return screen.findByRole("heading", { name: session.questions[0]!.prompt });
}

describe("Quiz", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("groups visually identical evidence without changing the session", () => {
    const first = ptSession.questions.find((question) => question.evidence.length > 0)!.evidence[0]!;
    const duplicate = { ...first, fact_base_id: "another-fact" };
    const evidence = [first, duplicate];
    const displayed = groupEvidence(evidence);
    expect(displayed).toHaveLength(1);
    expect(evidence).toHaveLength(2);
  });

  it("labels a Wikidata revision separately from its declared reference", () => {
    const displayed = groupEvidence([{
      fact_base_id: "fact",
      locator: "wikidata:Q1:P31",
      revision_id: 123,
      source_key: "domain:example.com",
      source_url: "https://www.wikidata.org/w/index.php?title=Special:EntityPage/Q1&oldid=123",
    }]);
    expect(displayed[0]).toMatchObject({
      project: "Wikidata",
      declaredReference: "example.com",
      revision_id: 123,
    });
  });

  it("loads the requested language and reveals sourced feedback", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(screen.getByText("Acertou.")).toBeInTheDocument();
    expect(screen.getByText(question.explanation)).toBeInTheDocument();
    expect(screen.getByText("Fonte da resposta")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Fonte da resposta"));
    expect(screen.getAllByText(/Wikidata|Wikipedia/)[0]).toBeInTheDocument();
    expect(screen.queryByText(question.evidence[0]!.locator)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Abrir revisão/ })[0]).toHaveAttribute("href", question.evidence[0]!.source_url);
  });

  it("ignores a stale session response after the locale changes", async () => {
    let releasePtManifest!: (response: Response) => void;
    const delayedPtManifest = new Promise<Response>((resolve) => { releasePtManifest = resolve; });
    const fetch = vi.fn((url: string) => {
      if (url.includes("pt-BR")) return Promise.resolve(new Response(`${JSON.stringify(ptSession)}\n`));
      if (url.includes("session.en")) return Promise.resolve(new Response(`${JSON.stringify(enSession)}\n`));
      if (fetch.mock.calls.length === 1) return delayedPtManifest;
      return Promise.resolve(new Response(JSON.stringify(manifest)));
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<Quiz locale="pt-BR" />);
    view.rerender(<Quiz locale="en" />);
    expect(await screen.findByRole("heading", { name: enSession.questions[0]!.prompt })).toBeInTheDocument();
    releasePtManifest(new Response(JSON.stringify(manifest)));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: enSession.questions[0]!.prompt })).toBeInTheDocument();
  });

  it("disables submission until an option is selected", async () => {
    await renderReady("en");
    const submit = screen.getByRole("button", { name: "Submit answer" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    expect(submit).toBeEnabled();
  });

  it("advances while keeping score", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }));
    expect(screen.getByRole("heading", { name: ptSession.questions[1]!.prompt })).toBeInTheDocument();
    expect(screen.getByText("Pergunta 2 de 10")).toBeInTheDocument();
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: ptSession.questions[1]!.prompt })).toHaveFocus();
  });

  it("records one point when submission is triggered twice", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    const submit = screen.getByRole("button", { name: "Responder" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }));
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("1");
  });

  it("submits automatically when the timer reaches zero", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());
    for (let second = 0; second < 20; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(screen.getByText("O tempo acabou.")).toBeInTheDocument();
    expect(screen.getByText(/Resposta correta/)).toBeInTheDocument();
  });

  it("freezes the timer after an answer is submitted", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    const frozenValue = screen.getByRole("timer").textContent;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByRole("timer")).toHaveTextContent(frozenValue!);
  });

  it("shows the missing state and retries the publication", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(ptSession)}\n`));
    vi.stubGlobal("fetch", fetch);
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByText("As perguntas deste idioma ainda não foram publicadas.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
