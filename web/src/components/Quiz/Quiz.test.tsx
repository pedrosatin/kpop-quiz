import { createHash } from "node:crypto";
import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupEvidence, Quiz } from "./Quiz";
import { NEXT_GUARD_MS } from "./AnswerFeedback";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import enSession from "../../tests/fixtures/session.en.standard.9c44914efa4be2eee52cf11ea63f542c8e913e01b5a58dc63d3627ed003e8c0e.json";
import assistedSession from "../../tests/fixtures/session.pt-BR.assisted.fa5f191cdb87584a302ac221ddc4c4520c49c5cc9ef79f1242b4219558f7a56e.json";
import expertSession from "../../tests/fixtures/session.pt-BR.expert.987d0b408ebba093fcebd95e04199ff967a4af740d1a2a82e1307b8ba4cba591.json";
import dailyPtSession from "../../tests/fixtures/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";
import manifest from "../../tests/fixtures/manifest-v2.json";

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
  expect(screen.getByText(/Carregando|Loading/)).toBeInTheDocument();
  const session = customPtSession ? customPtSession : (locale === "pt-BR" ? ptSession : enSession);
  await screen.findByRole("heading", { name: locale === "pt-BR" ? "Monte sua partida" : "Set up your game" });
  fireEvent.click(screen.getByRole("button", { name: locale === "pt-BR" ? "Começar partida" : "Start game" }));
  return screen.findByRole("heading", { name: session.questions[0]!.prompt });
}

// Next ignores activation for NEXT_GUARD_MS after it appears. Tests that
// answer and move on step this clock past the window first.
let now = 1_000;
function advanceClock(ms = NEXT_GUARD_MS) {
  now += ms;
}

function clickNext(name = "Próxima pergunta") {
  advanceClock();
  fireEvent.click(screen.getByRole("button", { name }));
}

// jsdom has no default action for Enter; a browser clicks the focused button
// unless a keydown handler cancels it.
function pressEnter(target: HTMLElement) {
  advanceClock();
  const notCancelled = fireEvent.keyDown(target, { key: "Enter", code: "Enter" });
  if (notCancelled && target instanceof HTMLButtonElement && document.activeElement === target) {
    fireEvent.click(target);
  }
}

describe("Quiz", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(screen.getByText("Você acertou.")).toBeInTheDocument();
    expect(screen.getByText(question.explanation)).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ver fonte" }));
    expect(screen.getByText(question.explanation)).toBeVisible();
    expect(screen.getAllByText(/Wikidata|Wikipedia/)[0]).toBeVisible();
    expect(screen.queryByText(question.evidence[0]!.locator)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Abrir a revisão/ })[0]).toHaveAttribute("href", question.evidence[0]!.source_url);
  });

  it("charges the declared cost when standard mode reveals a clue", async () => {
    await renderReady("pt-BR", dailyPtSession);
    const clueIndex = dailyPtSession.questions.findIndex((question) => question.clues_available.length > 0);
    for (let index = 0; index < clueIndex; index += 1) {
      const current = dailyPtSession.questions[index]!;
      const answer = current.options.find((option) => option.id === current.answer_option_id)!;
      fireEvent.click(screen.getByRole("radio", { name: answer.label }));
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      clickNext();
    }
    const question = dailyPtSession.questions[clueIndex]!;
    const clueButton = screen.getByRole("button", { name: `Ver pista (-${question.hint_cost} pontos)` });
    clueButton.focus();
    fireEvent.click(clueButton);
    expect(screen.getByRole("button", { name: "Pista aberta" })).toHaveFocus();
    const clueText = question.clues_available[0]!.text;
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes(clueText))).toBe(true);
    expect(screen.getByText(question.clues_available[0]!.text)).toBeInTheDocument();
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    clickNext();
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent(
      String(clueIndex * 100 + question.base_points - question.hint_cost),
    );
  });

  it("chooses a mode before starting and keeps expert free of clues", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Monte sua partida" });
    fireEvent.click(screen.getByRole("radio", { name: /Especialista/ }));
    const start = await screen.findByRole("button", { name: "Começar partida" });
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
    await screen.findByRole("heading", { name: "Set up your game" });
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
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
    clickNext();
    expect(screen.getByRole("heading", { name: ptSession.questions[1]!.prompt })).toBeInTheDocument();
    expect(screen.getByText("Pergunta 2 de 10")).toBeInTheDocument();
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("100");
    expect(screen.getByRole("heading", { name: ptSession.questions[1]!.prompt })).toHaveFocus();
  });

  it("focuses Next in the action bar after an answer and advances on Enter", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    const submit = screen.getByRole("button", { name: "Responder" });
    expect(submit.closest(".game-actions")).not.toBeNull();
    fireEvent.click(submit);
    const next = screen.getByRole("button", { name: "Próxima pergunta" });
    expect(next.closest(".game-actions")).not.toBeNull();
    await vi.waitFor(() => expect(next).toHaveFocus());
    pressEnter(next);
    expect(screen.getByRole("heading", { name: ptSession.questions[1]!.prompt })).toBeInTheDocument();
  });

  it("labels the player's answer and keeps the live region to the message after a miss", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const correct = question.options.find((option) => option.id === question.answer_option_id)!;
    const wrong = question.options.find((option) => option.id !== question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: wrong.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    const status = screen.getAllByRole("status").find((node) => node.closest(".game-actions"))!;
    expect(status).toHaveClass("game-actions-message");
    expect(status).toHaveTextContent(`Sua resposta: ${wrong.label} · Resposta correta: ${correct.label}`);
    expect(status.querySelector("button, a")).toBeNull();
    expect(status).not.toHaveTextContent(question.explanation);
    expect(screen.getAllByRole("status").filter((node) => node.closest(".game-actions"))).toHaveLength(1);
  });

  it("focuses the result title after Enter on the last answer", async () => {
    await renderReady();
    for (let index = 0; index < ptSession.questions.length; index += 1) {
      const question = ptSession.questions[index]!;
      fireEvent.click(screen.getByRole("radio", { name: question.options[0]!.label }));
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      const next = screen.getByRole("button", { name: index === ptSession.questions.length - 1 ? "Ver resultado" : "Próxima pergunta" });
      await vi.waitFor(() => expect(next).toHaveFocus());
      pressEnter(next);
    }
    const title = await screen.findByRole("heading", { name: "Fim da partida" });
    expect(title).toHaveAttribute("tabindex", "-1");
    await vi.waitFor(() => expect(title).toHaveFocus());
  });

  it("keeps the quiz in the same wide card from loading to the result", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    const card = () => document.getElementById("quiz")!;
    const expectWide = () => {
      expect(card()).toHaveClass("game-card");
      expect(card()).toHaveClass("game-card--wide");
    };
    expectWide();
    await screen.findByRole("heading", { name: "Monte sua partida" });
    expectWide();
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt });
    for (let index = 0; index < ptSession.questions.length; index += 1) {
      expectWide();
      fireEvent.click(screen.getByRole("radio", { name: ptSession.questions[index]!.options[0]!.label }));
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      expectWide();
      clickNext(index === ptSession.questions.length - 1 ? "Ver resultado" : "Próxima pergunta");
    }
    await screen.findByRole("heading", { name: "Fim da partida" });
    expectWide();
  });

  it("keeps the options in A, B, C, D order in the DOM, the order of the two-column grid", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const labels = [...document.querySelectorAll<HTMLLabelElement>("#quiz .options .option")];
    expect(labels.map((label) => label.querySelector(".option-key")!.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(labels.map((label) => label.querySelector("input")!.value)).toEqual(question.options.map((option) => option.id));
    // Arrow keys and Tab follow DOM order; the radios are the only focusable
    // elements in the group, in the same order.
    const focusable = [...document.querySelectorAll<HTMLElement>("#quiz .options input, #quiz .options button, #quiz .options a")];
    expect(focusable).toEqual(labels.map((label) => label.querySelector("input")));
    // Answering keeps the same order and the same classes on the grid.
    const grid = document.querySelector("#quiz .options")!;
    const gridClass = grid.className;
    fireEvent.click(screen.getByRole("radio", { name: question.options[2]!.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(document.querySelector("#quiz .options")!.className).toBe(gridClass);
    expect([...document.querySelectorAll("#quiz .options .option-key")].map((key) => key.textContent)).toEqual(["A", "B", "C", "D"]);
    // The CSS side (no order, reverse or grid placement) is in
    // src/tests/quiz-layout.test.ts.
  });

  it("records one point when submission is triggered twice", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    const submit = screen.getByRole("button", { name: "Responder" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    clickNext();
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("100");
  });

  it("submits automatically when the timer reaches zero", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Monte sua partida" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Limitar cada pergunta a 20 segundos" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());
    for (let second = 0; second < 20; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(screen.getByText("Acabou o tempo.")).toBeInTheDocument();
    expect(screen.getAllByRole("status").find((node) => node.closest(".game-actions"))).toHaveTextContent("Resposta correta");
  });

  it("freezes the timer after an answer is submitted", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Monte sua partida" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Limitar cada pergunta a 20 segundos" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
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
    expect(await screen.findByText("Este jogo ainda não está disponível em português.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByRole("heading", { name: "Monte sua partida" });
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
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
      advanceClock();
      fireEvent.click(nextButton);
    }
    const resultHeading = await screen.findByRole("heading", { name: "Fim da partida" });
    expect(resultHeading).toBeInTheDocument();
    expect(resultHeading).toHaveFocus();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("10/10")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Suas respostas" })).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "Monte sua partida" });
    const expertRadio = screen.getByRole("radio", { name: /Especialista/ }) as HTMLInputElement;
    const timerCheckbox = screen.getByRole("checkbox", { name: "Limitar cada pergunta a 20 segundos" }) as HTMLInputElement;
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
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Monte sua partida" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Limitar cada pergunta a 20 segundos" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());

    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));

    for (let second = 0; second < 20; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }

    expect(screen.getByText("Acabou o tempo.")).toBeInTheDocument();
    expect(screen.getAllByRole("status").find((node) => node.closest(".game-actions"))).toHaveTextContent("Resposta correta");
    expect(screen.queryByText("Você acertou.")).not.toBeInTheDocument();
  });

  it("does not reset the timer countdown when user selects options during question", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Monte sua partida" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Limitar cada pergunta a 20 segundos" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
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
    await screen.findByRole("heading", { name: "Monte sua partida" });

    const fetchedUrls = fetch.mock.calls.map((call) => call[0] as string);
    expect(fetchedUrls.some((url) => url.includes("standard"))).toBe(false);
    expect(fetchedUrls.some((url) => url.includes("expert"))).toBe(true);
  });

  it("initializes mode and theme from URL query parameters on mount", async () => {
    window.history.replaceState(null, "", "/?mode=expert&theme=daily");
    mockSessionFetch();

    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Monte sua partida" });

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    const dailyRadio = screen.getByRole("radio", { name: /Quiz do dia/ });

    expect(expertRadio).toBeChecked();
    expect(dailyRadio).toBeChecked();
  });

  it("updates URL with window.history.replaceState when user alters mode or theme", async () => {
    window.history.replaceState(null, "", "/");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    mockSessionFetch();

    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Monte sua partida" });

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    fireEvent.click(expertRadio);

    expect(replaceSpy).toHaveBeenCalled();
    const lastCallUrl = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1]![2] as string;
    expect(lastCallUrl).toContain("mode=expert");

    const dailyRadio = screen.getByRole("radio", { name: /Quiz do dia/ });
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
    await screen.findByRole("heading", { name: "Monte sua partida" });

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    fireEvent.click(expertRadio);

    expect(langLink.search).toContain("mode=expert");

    const dailyRadio = screen.getByRole("radio", { name: /Quiz do dia/ });
    fireEvent.click(dailyRadio);

    expect(langLink.search).toContain("theme=daily");

    document.body.removeChild(langLink);
  });
});

