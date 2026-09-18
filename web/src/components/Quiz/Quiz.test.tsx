import { createHash } from "node:crypto";
import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEvidence, Quiz } from "./Quiz";
import ptSession from "../../../public/data/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import enSession from "../../../public/data/session.en.standard.9c44914efa4be2eee52cf11ea63f542c8e913e01b5a58dc63d3627ed003e8c0e.json";
import assistedSession from "../../../public/data/session.pt-BR.assisted.fa5f191cdb87584a302ac221ddc4c4520c49c5cc9ef79f1242b4219558f7a56e.json";
import expertSession from "../../../public/data/session.pt-BR.expert.987d0b408ebba093fcebd95e04199ff967a4af740d1a2a82e1307b8ba4cba591.json";
import dailyPtSession from "../../../public/data/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";
import manifest from "../../../public/data/manifest-v2.json";

function mockSessionFetch(customPtSession?: any) {
  const testManifest = structuredClone(manifest) as Record<string, any>;
  if (customPtSession) {
    const raw = `${JSON.stringify(customPtSession)}\n`;
    const hash = createHash("sha256").update(raw).digest("hex");
    testManifest.sessions["pt-BR.standard"] = {
      path: `session.pt-BR.standard.${hash}.json`,
      sha256: hash,
      session_id: customPtSession.session_id,
    };
  }
  for (const locale of ["pt-BR", "en"]) {
    for (const mode of ["assisted", "standard", "expert"]) {
      testManifest.sessions[`daily.${locale}.${mode}`] = {
        path: `session.daily.${locale}.${mode}.${testManifest.sessions[`${locale}.${mode}`].sha256}.json`,
        sha256: testManifest.sessions[`${locale}.${mode}`].sha256,
        session_id: testManifest.sessions[`${locale}.${mode}`].session_id,
      };
    }
  }
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const payload = url.endsWith("manifest-v2.json") ? testManifest
      : url.includes("pt-BR.assisted") ? assistedSession
      : url.includes("pt-BR.expert") ? expertSession
      : url.includes("pt-BR") ? (customPtSession ?? ptSession) : enSession;
    return Promise.resolve(new Response(`${JSON.stringify(payload)}${url.endsWith("manifest-v2.json") ? "" : "\n"}`));
  }));
}

async function renderReady(locale: "pt-BR" | "en" = "pt-BR", customPtSession?: any) {
  mockSessionFetch(customPtSession);
  render(<Quiz locale={locale} />);
  expect(screen.getByText(/Preparando|Preparing/)).toBeInTheDocument();
  const session = customPtSession ? customPtSession : (locale === "pt-BR" ? ptSession : enSession);
  await screen.findByRole("heading", { name: locale === "pt-BR" ? "Escolha como jogar" : "Choose how to play" });
  fireEvent.click(screen.getByRole("button", { name: locale === "pt-BR" ? "Começar rodada" : "Start round" }));
  return screen.findByRole("heading", { name: session.questions[0]!.prompt });
}

describe("Quiz", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
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

  it("charges the declared cost when standard mode reveals a clue", async () => {
    await renderReady("pt-BR", dailyPtSession);
    const clueIndex = dailyPtSession.questions.findIndex((question) => question.clues_available.length > 0);
    for (let index = 0; index < clueIndex; index += 1) {
      const current = dailyPtSession.questions[index]!;
      const answer = current.options.find((option) => option.id === current.answer_option_id)!;
      fireEvent.click(screen.getByRole("radio", { name: answer.label }));
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }));
    }
    const question = dailyPtSession.questions[clueIndex]!;
    const clueButton = screen.getByRole("button", { name: `Revelar pista (-${question.hint_cost} pontos)` });
    clueButton.focus();
    fireEvent.click(clueButton);
    expect(screen.getByRole("button", { name: "Pista revelada" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(question.clues_available[0]!.text);
    expect(screen.getByText(question.clues_available[0]!.text)).toBeInTheDocument();
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }));
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent(
      String(clueIndex * 100 + question.base_points - question.hint_cost),
    );
  });

  it("chooses a mode before starting and keeps expert free of clues", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Escolha como jogar" });
    fireEvent.click(screen.getByRole("radio", { name: /Especialista/ }));
    const start = await screen.findByRole("button", { name: "Começar rodada" });
    await vi.waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    const heading = await screen.findByRole("heading", { name: expertSession.questions[0]!.prompt });
    await vi.waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: /pista/i })).not.toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "Choose how to play" });
    fireEvent.click(screen.getByRole("button", { name: "Start round" }));
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
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("100");
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
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("100");
  });

  it("submits automatically when the timer reaches zero", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Escolha como jogar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Usar 20 segundos por pergunta" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar rodada" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());
    for (let second = 0; second < 20; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(screen.getByText("O tempo acabou.")).toBeInTheDocument();
    expect(screen.getByText(/Resposta correta/)).toBeInTheDocument();
  });

  it("freezes the timer after an answer is submitted", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Escolha como jogar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Usar 20 segundos por pergunta" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar rodada" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    const frozenValue = screen.getByRole("timer").textContent;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_100)); });
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
    await screen.findByRole("heading", { name: "Escolha como jogar" });
    fireEvent.click(screen.getByRole("button", { name: "Começar rodada" }));
    expect(await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("completes all questions, displays results, and restarts the round", async () => {
    await renderReady();
    for (let index = 0; index < ptSession.questions.length; index += 1) {
      const question = ptSession.questions[index]!;
      const answer = question.options.find((option) => option.id === question.answer_option_id)!;
      fireEvent.click(screen.getByRole("radio", { name: answer.label }));
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      const isLast = index === ptSession.questions.length - 1;
      const nextButton = screen.getByRole("button", { name: isLast ? "Ver resultado" : "Próxima pergunta" });
      fireEvent.click(nextButton);
    }
    const resultHeading = await screen.findByRole("heading", { name: "Fim da rodada" });
    expect(resultHeading).toBeInTheDocument();
    expect(resultHeading).toHaveFocus();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("10/10")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Revisão das respostas" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
    const firstHeading = await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt });
    expect(firstHeading).toBeInTheDocument();
    expect(firstHeading).toHaveFocus();
  });

  it("persists play-mode and timer preferences in localStorage", async () => {
    mockSessionFetch();
    window.localStorage.setItem("kpop-quiz-play-mode", "expert");
    window.localStorage.setItem("kpop-quiz-timer-enabled", "true");
    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Escolha como jogar" });
    const expertRadio = screen.getByRole("radio", { name: /Especialista/ }) as HTMLInputElement;
    const timerCheckbox = screen.getByRole("checkbox", { name: "Usar 20 segundos por pergunta" }) as HTMLInputElement;
    expect(expertRadio.checked).toBe(true);
    expect(timerCheckbox.checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Assistido/ }));
    expect(window.localStorage.getItem("kpop-quiz-play-mode")).toBe("assisted");

    fireEvent.click(timerCheckbox);
    expect(window.localStorage.getItem("kpop-quiz-timer-enabled")).toBe("false");
  });

  it("shows timeout feedback and correct answer when timer expires even if correct option was selected", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Escolha como jogar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Usar 20 segundos por pergunta" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar rodada" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());

    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));

    for (let second = 0; second < 20; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }

    expect(screen.getByText("O tempo acabou.")).toBeInTheDocument();
    expect(screen.getByText(/Resposta correta/)).toBeInTheDocument();
    expect(screen.queryByText("Acertou.")).not.toBeInTheDocument();
  });

  it("does not reset the timer countdown when user selects options during question", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Escolha como jogar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Usar 20 segundos por pergunta" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar rodada" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());

    // Advance 500ms into the first second
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // Select an option, triggering a re-render
    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!);

    // Advance remaining 500ms (total 1000ms from start)
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // Timer should have ticked from 20s down to 19s
    expect(screen.getByRole("timer")).toHaveTextContent("19s");
  });

  it("initializes playMode lazily from localStorage avoiding double session fetch", async () => {
    window.localStorage.setItem("kpop-quiz-play-mode", "expert");
    const fetch = vi.fn((url: string) => {
      const payload = url.endsWith("manifest-v2.json") ? manifest : expertSession;
      return Promise.resolve(new Response(`${JSON.stringify(payload)}\n`));
    });
    vi.stubGlobal("fetch", fetch);

    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Escolha como jogar" });

    const fetchedUrls = fetch.mock.calls.map((call) => call[0] as string);
    expect(fetchedUrls.some((url) => url.includes("standard"))).toBe(false);
    expect(fetchedUrls.some((url) => url.includes("expert"))).toBe(true);
  });

  it("initializes mode and theme from URL query parameters on mount", async () => {
    window.history.replaceState(null, "", "/?mode=expert&theme=daily");
    mockSessionFetch();

    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Escolha como jogar" });

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    const dailyRadio = screen.getByRole("radio", { name: /Partida diária/ });

    expect(expertRadio).toBeChecked();
    expect(dailyRadio).toBeChecked();
  });

  it("updates URL with window.history.replaceState when user alters mode or theme", async () => {
    window.history.replaceState(null, "", "/");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    mockSessionFetch();

    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Escolha como jogar" });

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    fireEvent.click(expertRadio);

    expect(replaceSpy).toHaveBeenCalled();
    const lastCallUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1]![2] as string;
    expect(lastCallUrl).toContain("mode=expert");

    const dailyRadio = screen.getByRole("radio", { name: /Partida diária/ });
    fireEvent.click(dailyRadio);

    const afterThemeUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1]![2] as string;
    expect(afterThemeUrl).toContain("theme=daily");
    expect(afterThemeUrl).toContain("mode=expert");
  });

  it("synchronizes language switch link href with current mode and theme URL parameters", async () => {
    const langLink = document.createElement("a");
    langLink.className = "language-link";
    langLink.href = "/en/";
    document.body.appendChild(langLink);

    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Escolha como jogar" });

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    fireEvent.click(expertRadio);

    expect(langLink.search).toContain("mode=expert");

    const dailyRadio = screen.getByRole("radio", { name: /Partida diária/ });
    fireEvent.click(dailyRadio);

    expect(langLink.search).toContain("theme=daily");

    document.body.removeChild(langLink);
  });
});

