import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Quiz } from "./Quiz";
import ptSession from "../../../public/data/session.pt-BR.5d76c46b8310c1e9f0f784a9b6dadd6d3d7872f51b0b64c2d4eb12cf29ab2621.json";
import enSession from "../../../public/data/session.en.622658954ce270fede6f7ad0bfc2b0fee134d3c6c00873a587cdfeac992df378.json";
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
    expect(screen.getAllByText(/\.co\.kr|\.com|\.jp|Wikipedia/)[0]).toBeInTheDocument();
    expect(screen.queryByText(question.evidence[0]!.locator)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Abrir fonte/ })[0]).toHaveAttribute("href", question.evidence[0]!.source_url);
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
