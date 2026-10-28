import { createHash } from "node:crypto";
import { act, fireEvent, render, screen } from "@testing-library/preact";
import { hydrate, render as preactRender } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupEvidence, Quiz } from "./Quiz";
import { NEXT_GUARD_MS } from "./AnswerFeedback";
import fs from "node:fs";
import path from "node:path";
import ptSession from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import enSession from "../../tests/fixtures/session.en.standard.9c44914efa4be2eee52cf11ea63f542c8e913e01b5a58dc63d3627ed003e8c0e.json";
import assistedSession from "../../tests/fixtures/session.pt-BR.assisted.fa5f191cdb87584a302ac221ddc4c4520c49c5cc9ef79f1242b4219558f7a56e.json";
import expertSession from "../../tests/fixtures/session.pt-BR.expert.987d0b408ebba093fcebd95e04199ff967a4af740d1a2a82e1307b8ba4cba591.json";
import dailyPtSession from "../../tests/fixtures/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";
import manifest from "../../tests/fixtures/manifest-v2.json";
import { clearCatalogCache } from "../../data/catalog-loader";
import {
  buildQuizProgressEnvelope,
  buildQuizProgressSave,
  QUIZ_PROGRESS_STORAGE_KEY,
  saveQuizProgress,
} from "./storage";
import type { QuizSession } from "../../lib/quiz-types";
import { isGameMatchRecorded, PLAYER_STATS_STORAGE_KEY } from "../../lib/player-stats";

const CATALOG_DIR = path.resolve(__dirname, "../../tests/fixtures/catalog");
const catalogManifest = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, "catalog-manifest-v1.json"), "utf-8"));

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serve a catalog whose pt-BR.standard pool has exactly ten questions (repeats). */
async function mockCatalogFetchWithTenEligible() {
  const files = new Map<string, Uint8Array | string>();
  for (const name of fs.readdirSync(CATALOG_DIR)) {
    files.set(name, fs.readFileSync(path.join(CATALOG_DIR, name)));
  }
  const catalogMan = structuredClone(catalogManifest) as Record<string, any>;
  const key = "pt-BR.standard";
  const entry = catalogMan.shards[key];
  const shard = JSON.parse(Buffer.from(files.get(entry.path) as Buffer).toString("utf-8"));
  shard.questions = shard.questions.slice(0, 10);
  shard.pools = {
    all: shard.questions.map((_: unknown, index: number) => index),
    "decade.1990": [],
    "decade.2000": shard.questions.map((_: unknown, index: number) => index),
    "decade.2010": [],
    "decade.2020": [],
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(shard)}\n`);
  entry.sha256 = await sha256Hex(bytes);
  entry.path = `catalog.${key}.${entry.sha256}.json`;
  entry.questions = 10;
  entry.pools = {
    all: 10, "decade.1990": 0, "decade.2000": 10, "decade.2010": 0, "decade.2020": 0,
  };
  files.set(entry.path, bytes);
  const versionLines = [
    "kpop-quiz-catalog-manifest-v1",
    catalogMan.dataset_version,
    ...Object.keys(catalogMan.shards).sort().map((shardKey) => `${shardKey}:${catalogMan.shards[shardKey].sha256}`),
  ];
  catalogMan.catalog_version = await sha256Hex(versionLines.join("\n"));
  const legacyManifest = structuredClone(manifest) as Record<string, any>;

  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = url.split("/data/")[1] ?? "";
    if (name === "catalog-manifest-v1.json") return new Response(JSON.stringify(catalogMan));
    if (files.has(name)) {
      const body = files.get(name)!;
      return new Response(typeof body === "string" ? body : new Uint8Array(body));
    }
    if (url.endsWith("manifest-v3.json")) return new Response(null, { status: 404 });
    if (url.endsWith("manifest-v2.json")) return new Response(JSON.stringify(legacyManifest));
    if (url.includes("pt-BR.assisted")) return new Response(`${JSON.stringify(assistedSession)}\n`);
    if (url.includes("pt-BR.expert")) return new Response(`${JSON.stringify(expertSession)}\n`);
    if (url.includes("pt-BR")) return new Response(`${JSON.stringify(ptSession)}\n`);
    return new Response(`${JSON.stringify(enSession)}\n`);
  }));
}

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
    // QUIZ_CATALOG off: no catalog published. A 404 keeps the legacy session path.
    if (url.includes("catalog-manifest") || url.includes("/catalog.")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    const payload = url.endsWith("manifest-v2.json") ? testManifest
      : url.includes("pt-BR.assisted") ? assistedSession
      : url.includes("pt-BR.expert") ? expertSession
      : url.includes("pt-BR") ? (customPtSession ?? ptSession) : enSession;
    return Promise.resolve(new Response(`${JSON.stringify(payload)}${url.endsWith("manifest-v2.json") ? "" : "\n"}`));
  }));
}

// The setup renders while the session loads; Start enables once it is ready.
async function waitForSetupReady(title = "Monte sua partida") {
  await screen.findByRole("heading", { name: title });
  await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
}

async function renderReady(locale: "pt-BR" | "en" = "pt-BR", customPtSession?: any) {
  mockSessionFetch(customPtSession);
  render(<Quiz locale={locale} />);
  expect(screen.getByTestId("game-setup")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByTestId("game-start")).toBeDisabled();
  const session = customPtSession ? customPtSession : (locale === "pt-BR" ? ptSession : enSession);
  await waitForSetupReady(locale === "pt-BR" ? "Monte sua partida" : "Set up your game");
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

function mockCatalogFetch() {
  const files = new Map<string, Buffer>();
  for (const name of fs.readdirSync(CATALOG_DIR)) {
    files.set(name, fs.readFileSync(path.join(CATALOG_DIR, name)));
  }
  const testManifest = structuredClone(manifest) as Record<string, any>;
  // Point daily entries at the fixture daily session bytes, matching mockSessionFetch.
  const dailyRaw = `${JSON.stringify(dailyPtSession)}\n`;
  const dailyHash = createHash("sha256").update(dailyRaw).digest("hex");
  for (const locale of ["pt-BR", "en"]) {
    for (const mode of ["assisted", "standard", "expert"]) {
      testManifest.sessions[`daily.${locale}.${mode}`] = {
        path: `session.daily.${locale}.${mode}.${dailyHash}.json`,
        sha256: dailyHash,
        session_id: dailyPtSession.session_id,
      };
    }
  }
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = url.split("/data/")[1] ?? "";
    if (name === "catalog-manifest-v1.json") {
      return new Response(JSON.stringify(catalogManifest));
    }
    if (files.has(name)) return new Response(new Uint8Array(files.get(name)!));
    if (url.endsWith("manifest-v3.json")) return new Response(null, { status: 404 });
    if (url.endsWith("manifest-v2.json")) return new Response(JSON.stringify(testManifest));
    if (url.includes("session.daily")) {
      return new Response(dailyRaw);
    }
    if (url.includes("pt-BR.assisted")) return new Response(`${JSON.stringify(assistedSession)}\n`);
    if (url.includes("pt-BR.expert")) return new Response(`${JSON.stringify(expertSession)}\n`);
    if (url.includes("pt-BR")) return new Response(`${JSON.stringify(ptSession)}\n`);
    return new Response(`${JSON.stringify(enSession)}\n`);
  }));
}

describe("Quiz", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockImplementation(() => now);
    clearCatalogCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    clearCatalogCache();
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

  it("falls back to published sessions when the question catalog is not published", async () => {
    await renderReady("pt-BR");
    const requested = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([url]) => url);
    expect(requested.some((url) => url.includes("catalog-manifest"))).toBe(true);
    expect(requested.some((url) => url.includes("manifest-v2.json") || url.includes("session."))).toBe(true);
  });

  it("shows the legacy repeat notice when the catalog is absent", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();
    expect(screen.getByTestId("quiz-replay-notice")).toHaveTextContent(
      /catálogo de perguntas novas ainda não está disponível/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    for (let index = 0; index < ptSession.questions.length; index += 1) {
      fireEvent.click(screen.getAllByRole("radio")[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      const isLast = index === ptSession.questions.length - 1;
      advanceClock();
      fireEvent.click(screen.getByRole("button", { name: isLast ? "Ver resultado" : "Próxima pergunta" }));
    }
    await screen.findByRole("heading", { name: "Fim da partida" });
    expect(screen.getByTestId("quiz-replay-notice")).toHaveTextContent(
      /catálogo de perguntas novas ainda não está disponível/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
    await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt });
    // Restart on the legacy path keeps the same published set with the notice.
  });

  it("shows the catalog repeat notice when exactly ten questions are eligible", async () => {
    await mockCatalogFetchWithTenEligible();
    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();
    expect(screen.getByTestId("quiz-replay-notice")).toHaveTextContent(
      /Só há dez perguntas elegíveis/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getAllByRole("radio")[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      const isLast = index === 9;
      advanceClock();
      fireEvent.click(screen.getByRole("button", { name: isLast ? "Ver resultado" : "Próxima pergunta" }));
    }
    await screen.findByRole("heading", { name: "Fim da partida" });
    expect(screen.getByTestId("quiz-replay-notice")).toHaveTextContent(
      /Só há dez perguntas elegíveis/,
    );
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

  it("tells the player a question has no clue and charges nothing", async () => {
    await renderReady("pt-BR", dailyPtSession);
    const first = dailyPtSession.questions[0]!;
    expect(first.clues_available).toHaveLength(0);
    expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent(
      "Esta pergunta não tem pista disponível. Nenhum ponto será descontado.",
    );
    expect(screen.queryByRole("button", { name: /Ver pista/ })).not.toBeInTheDocument();
    const answer = first.options.find((option) => option.id === first.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(screen.queryByTestId("quiz-no-clue")).not.toBeInTheDocument();
    clickNext();
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent(String(first.base_points));
  });

  it("lists the source of a clue the player opened next to the answer's", async () => {
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
    expect(screen.queryByTestId("quiz-no-clue")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Ver pista (-${question.hint_cost} pontos)` }));
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver fonte" }));
    const source = screen.getByTestId("quiz-clue-source");
    expect(source).toHaveTextContent(question.clues_available[0]!.text);
    expect(source.querySelector("a")).toHaveAttribute("href", question.clues_available[0]!.evidence[0]!.source_url);
  });

  it("chooses a mode before starting and keeps expert free of clues", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();
    fireEvent.click(screen.getByRole("radio", { name: /Especialista/ }));
    const start = await screen.findByRole("button", { name: "Começar partida" });
    await vi.waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    const heading = await screen.findByRole("heading", { name: expertSession.questions[0]!.prompt });
    await vi.waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: /pista/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("quiz-no-clue")).not.toBeInTheDocument();
  });

  it("ignores a stale session response after the locale changes", async () => {
    let releasePtSession!: (response: Response) => void;
    const delayedPtSession = new Promise<Response>((resolve) => { releasePtSession = resolve; });
    const fetch = vi.fn((url: string) => {
      if (url.includes("catalog-manifest") || url.includes("/catalog.")) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (url.endsWith("manifest-v3.json")) return Promise.resolve(new Response(null, { status: 404 }));
      if (url.endsWith("manifest-v2.json")) return Promise.resolve(new Response(JSON.stringify(manifest)));
      if (url.includes("session") && url.includes("pt-BR")) return delayedPtSession;
      if (url.includes("session") && url.includes(".en.")) {
        return Promise.resolve(new Response(`${JSON.stringify(enSession)}\n`));
      }
      return Promise.resolve(new Response(`${JSON.stringify(enSession)}\n`));
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<Quiz locale="pt-BR" />);
    view.rerender(<Quiz locale="en" />);
    await waitForSetupReady("Set up your game");
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect(await screen.findByRole("heading", { name: enSession.questions[0]!.prompt })).toBeInTheDocument();
    releasePtSession(new Response(`${JSON.stringify(ptSession)}\n`));
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

  it("shows the busy setup with the decade picker while the session loads", async () => {
    mockSessionFetch();
    render(<Quiz locale="pt-BR" initialAvailableDecades={[1990, 2000, 2010, 2020]} />);
    expect(screen.getByRole("heading", { name: "Monte sua partida" })).toBeInTheDocument();
    expect(screen.getByTestId("game-start")).toBeDisabled();
    expect(document.querySelector(".decade-picker")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Carregando/);
    await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
    expect(screen.getByTestId("game-setup")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByText(/Carregando/)).toBeNull();
  });

  it("highlights only the stored difficulty after hydrating the server-rendered setup", async () => {
    // The server has no localStorage, so its HTML marks the default mode as selected.
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Quiz locale="pt-BR" initialAvailableDecades={[1990, 2000, 2010, 2020]} />);
    document.body.appendChild(container);
    window.localStorage.setItem("kpop-quiz-play-mode", "expert");
    mockSessionFetch();
    await act(() => { hydrate(<Quiz locale="pt-BR" initialAvailableDecades={[1990, 2000, 2010, 2020]} />, container); });
    await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>("[data-testid=game-start]")).toBeEnabled());
    const selected = container.querySelectorAll(".difficulty-picker .choice.selected");
    expect(selected).toHaveLength(1);
    const checked = selected[0]!.querySelector<HTMLInputElement>("input:checked");
    expect(checked?.value).toBe("expert");
    act(() => preactRender(null, container));
    container.remove();
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
    await waitForSetupReady();
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
    await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
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
    await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
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
    // Catalog absent; only manifest-v2.json is published, and its first request is a 404.
    let legacyManifestRequests = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("catalog-manifest") || url.includes("/catalog.")) {
        return new Response(null, { status: 404 });
      }
      if (url.endsWith("manifest-v3.json")) return new Response(null, { status: 404 });
      if (url.endsWith("manifest-v2.json")) {
        legacyManifestRequests += 1;
        return legacyManifestRequests === 1 ? new Response(null, { status: 404 }) : new Response(JSON.stringify(manifest));
      }
      return new Response(`${JSON.stringify(ptSession)}\n`);
    });
    vi.stubGlobal("fetch", fetch);
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByText("Este jogo ainda não está disponível em português.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitForSetupReady();
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    expect(await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument();
    expect(legacyManifestRequests).toBe(2);
    // catalog probe + v3 + v2 (miss), then retry: catalog + v3 + v2 + session = 7
    expect(fetch).toHaveBeenCalledTimes(7);
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

  it("records every question exactly once when giving up, answered or not", async () => {
    await renderReady();
    const total = ptSession.questions.length;

    // Unanswered: give up on the first question.
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("heading", { name: "Fim da partida" });
    expect(document.querySelectorAll(".review-item")).toHaveLength(total);

    // Answered: answer the first question, then give up from the verdict.
    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
    await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt });
    const question = ptSession.questions[0]!;
    fireEvent.click(screen.getByRole("radio", { name: question.options[0]!.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("heading", { name: "Fim da partida" });
    expect(document.querySelectorAll(".review-item")).toHaveLength(total);

    // Double confirm in the same tick records nothing twice.
    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
    await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt });
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    const confirm = screen.getByRole("button", { name: "Sim, desistir" });
    act(() => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await screen.findByRole("heading", { name: "Fim da partida" });
    expect(document.querySelectorAll(".review-item")).toHaveLength(total);
  });

  it("asks for confirmation before giving up and keeps the round on cancel or Escape", async () => {
    await renderReady();
    const prompt = ptSession.questions[0]!.prompt;

    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    expect(screen.getByRole("dialog", { name: "Desistir da partida?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: prompt })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fim da partida" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: prompt })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: prompt })).toBeInTheDocument();
  });

  it("closes a pending give-up confirm when the timer expires and ignores a delayed confirm", async () => {
    vi.useFakeTimers();
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "Limitar cada pergunta a 20 segundos" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    expect(screen.getByRole("dialog", { name: "Desistir da partida?" })).toBeInTheDocument();

    for (let second = 0; second < 20; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Acabou o tempo.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fim da partida" })).not.toBeInTheDocument();

    // After timeout the round stays on the verdict; give-up still needs a fresh confirm.
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("Acabou o tempo.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fim da partida" })).not.toBeInTheDocument();
  });

  it("shows English give-up confirmation copy", async () => {
    await renderReady("en");
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(screen.getByRole("dialog", { name: "Give up this game?" })).toBeInTheDocument();
    expect(screen.getByText("You will lose your progress in this game.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("persists play-mode and timer preferences in localStorage", async () => {
    mockSessionFetch();
    window.localStorage.setItem("kpop-quiz-play-mode", "expert");
    window.localStorage.setItem("kpop-quiz-timer-enabled", "true");
    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();
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
    await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
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
    await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
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
      if (url.includes("catalog-manifest") || url.includes("/catalog.")) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const payload = url.endsWith("manifest-v2.json") ? manifest : expertSession;
      return Promise.resolve(new Response(`${JSON.stringify(payload)}\n`));
    });
    vi.stubGlobal("fetch", fetch);

    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();

    const fetchedUrls = fetch.mock.calls.map((call) => call[0] as string);
    expect(fetchedUrls.some((url) => url.includes("session") && url.includes("standard"))).toBe(false);
    expect(fetchedUrls.some((url) => url.includes("expert"))).toBe(true);
  });

  it("initializes mode and theme from URL query parameters on mount", async () => {
    window.history.replaceState(null, "", "/?mode=expert&theme=daily");
    mockSessionFetch();

    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();

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
    await waitForSetupReady();

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
    await waitForSetupReady();

    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    fireEvent.click(expertRadio);

    expect(langLink.search).toContain("mode=expert");

    const dailyRadio = screen.getByRole("radio", { name: /Quiz do dia/ });
    fireEvent.click(dailyRadio);

    expect(langLink.search).toContain("theme=daily");

    document.body.removeChild(langLink);
  });

  it("draws the general quiz from the catalog and changes the set on replay", async () => {
    mockCatalogFetch();
    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();
    const requested = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([url]) => url);
    expect(requested.some((url) => url.includes("catalog-manifest"))).toBe(true);
    expect(requested.some((url) => url.includes("catalog.pt-BR.standard"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    const firstPrompt = (await screen.findByRole("heading", { level: 2 })).textContent!;
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getAllByRole("radio")[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Responder" }));
      const isLast = index === 9;
      advanceClock();
      fireEvent.click(screen.getByRole("button", { name: isLast ? "Ver resultado" : "Próxima pergunta" }));
    }
    await screen.findByRole("heading", { name: "Fim da partida" });
    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));
    const replayPrompt = await screen.findByRole("heading", { level: 2 });
    await vi.waitFor(() => expect(replayPrompt.textContent).not.toBe(firstPrompt));
    await act(async () => { await Promise.resolve(); });
  });

  it("keeps the daily quiz on the published session without reading catalog shards", async () => {
    window.history.replaceState(null, "", "/?theme=daily&mode=standard");
    const dailyRaw = `${JSON.stringify(dailyPtSession)}\n`;
    const dailyHash = createHash("sha256").update(dailyRaw).digest("hex");
    const testManifest = structuredClone(manifest) as Record<string, any>;
    for (const locale of ["pt-BR", "en"]) {
      for (const mode of ["assisted", "standard", "expert"]) {
        testManifest.sessions[`daily.${locale}.${mode}`] = {
          path: `session.daily.${locale}.${mode}.${dailyHash}.json`,
          sha256: dailyHash,
          session_id: dailyPtSession.session_id,
        };
      }
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("catalog-manifest") || /\/catalog\./.test(url)) {
        return new Response(null, { status: 404 });
      }
      if (url.endsWith("manifest-v3.json")) return new Response(null, { status: 404 });
      if (url.endsWith("manifest-v2.json")) return new Response(JSON.stringify(testManifest));
      if (url.includes("session.daily")) return new Response(dailyRaw);
      return new Response(`${JSON.stringify(ptSession)}\n`);
    });
    vi.stubGlobal("fetch", fetchMock);
    // Absorb orphan catalog shard requests still resolving from the previous
    // catalog case (manifest already done; shard fetch can land after unstub).
    for (let quiet = 0; quiet < 3; ) {
      const before = fetchMock.mock.calls.length;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      quiet = fetchMock.mock.calls.length === before ? quiet + 1 : 0;
    }
    fetchMock.mockClear();
    render(<Quiz locale="pt-BR" />);
    await waitForSetupReady();
    const requested = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.includes("catalog-manifest") || /\/catalog\./.test(url))).toBe(false);
    expect(requested.some((url) => url.includes("session.daily"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Começar partida" }));
    expect(await screen.findByRole("heading", { name: dailyPtSession.questions[0]!.prompt })).toBeInTheDocument();
  });

  it("includes catalog_version in the Q04 progress envelope for catalog rounds", async () => {
    mockCatalogFetch();
    const { selectCatalogRound } = await import("../../data/catalog-session");
    const round = await selectCatalogRound({
      locale: "pt-BR", playMode: "standard", avoidPrevious: false, baseUrl: "/",
    });
    const envelope = buildQuizProgressEnvelope(round.session, "catalog");
    expect(envelope.catalog_version).toBe(round.catalogVersion);
    expect(envelope.session_source).toBe("catalog");
    expect(envelope.session_id).toBe(round.session.session_id);
    const publishedEnvelope = buildQuizProgressEnvelope(ptSession as typeof round.session, "published");
    expect(publishedEnvelope.catalog_version).toBeUndefined();
    expect(publishedEnvelope.session_source).toBe("published");
  });

  it("shows unavailability for a decade filter with fewer than ten catalog questions", async () => {
    mockCatalogFetch();
    window.history.replaceState(null, "", "/?decade=1990");
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByText(/Não há perguntas suficientes/)).toBeInTheDocument();
  });

  it("saves and restores an unanswered question with pending selection (pt-BR)", async () => {
    await renderReady();
    const question = ptSession.questions[0]!;
    const option = question.options[0]!;
    fireEvent.click(screen.getByRole("radio", { name: option.label }));
    await vi.waitFor(() => {
      const raw = window.localStorage.getItem(QUIZ_PROGRESS_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).selected_id).toBe(option.id);
    });

    document.body.innerHTML = "";
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByRole("heading", { name: question.prompt })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: option.label })).toBeChecked();
    expect(screen.queryByRole("heading", { name: "Monte sua partida" })).not.toBeInTheDocument();
  });

  it("restores answered feedback and used clues without duplicating stats", async () => {
    window.localStorage.setItem("kpop-quiz-consent", "rejected");
    await renderReady();
    const question = ptSession.questions[0]!;
    const answer = question.options.find((option) => option.id === question.answer_option_id)!;
    fireEvent.click(screen.getByRole("radio", { name: answer.label }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(await screen.findByText("Você acertou.")).toBeInTheDocument();

    document.body.innerHTML = "";
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByText("Você acertou.")).toBeInTheDocument();

    clickNext();
    // Finish remaining questions quickly through give-up to reach results twice.
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    await screen.findByRole("heading", { name: "Fim da partida" });
    const matchId = `session-${ptSession.session_id}`;
    expect(isGameMatchRecorded("quiz", matchId)).toBe(true);
    const statsAfterFirst = window.localStorage.getItem(PLAYER_STATS_STORAGE_KEY);

    document.body.innerHTML = "";
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    await screen.findByRole("heading", { name: "Fim da partida" });
    expect(window.localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBe(statsAfterFirst);
  });

  it("restores a revealed clue from the embedded session save", async () => {
    const base = structuredClone(ptSession) as QuizSession;
    const evidence = base.questions[0]!.evidence[0]!;
    const clue = {
      id: "c".repeat(64),
      type: "decade" as const,
      text: "Pista salva para retomada.",
      fact_base_ids: [base.questions[0]!.fact_base_ids[0]!],
      evidence: [{
        fact_base_id: base.questions[0]!.fact_base_ids[0]!,
        source_key: evidence.source_key,
        source_url: evidence.source_url,
        revision_id: evidence.revision_id,
        locator: evidence.locator,
      }],
    };
    base.questions[0]!.clues_available = [clue];
    const save = buildQuizProgressSave({
      session: base,
      sessionSource: "published",
      locale: "pt-BR",
      playMode: "standard",
      theme: "history",
      decades: [],
      timerEnabled: false,
      machineState: "question.ready",
      questionIndex: 0,
      selectedId: null,
      timedOut: false,
      score: 0,
      revealedClues: [clue.id],
      history: [],
      questionDeadlineMs: null,
      startedAtMs: Date.now() - 10_000,
      elapsedSeconds: 0,
      gaveUp: false,
      replayNotice: "legacy-repeats",
    });
    saveQuizProgress(save);
    mockSessionFetch(base);
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByRole("heading", { name: base.questions[0]!.prompt })).toBeInTheDocument();
    expect(screen.getByText("Pista salva para retomada.")).toBeInTheDocument();
  });

  it("restores an already-elapsed deadline and expires once without skipping ahead", async () => {
    const startedAt = Date.now() - 30_000;
    const save = buildQuizProgressSave({
      session: ptSession as QuizSession,
      sessionSource: "published",
      locale: "pt-BR",
      playMode: "standard",
      theme: "history",
      decades: [],
      timerEnabled: true,
      machineState: "question.ready",
      questionIndex: 0,
      selectedId: null,
      timedOut: false,
      score: 0,
      revealedClues: [],
      history: [],
      questionDeadlineMs: Date.now() - 1_000,
      startedAtMs: startedAt,
      elapsedSeconds: 0,
      gaveUp: false,
      replayNotice: "legacy-repeats",
    });
    saveQuizProgress(save);
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByText("Acabou o tempo.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fim da partida" })).not.toBeInTheDocument();
    // Still the first question's feedback — did not auto-advance several times.
    expect(screen.getByRole("button", { name: "Próxima pergunta" })).toBeInTheDocument();
  });

  it("does not authorize give-up from a confirmation that was open before reload", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Persist happens for question.ready; confirm open is not part of the save.
    await vi.waitFor(() => expect(window.localStorage.getItem(QUIZ_PROGRESS_STORAGE_KEY)).toBeTruthy());
    const parsed = JSON.parse(window.localStorage.getItem(QUIZ_PROGRESS_STORAGE_KEY)!);
    expect(parsed).not.toHaveProperty("confirm_give_up_open");

    document.body.innerHTML = "";
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByRole("heading", { name: ptSession.questions[0]!.prompt })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fim da partida" })).not.toBeInTheDocument();
  });

  it("warns and stays usable when the saved schema is incompatible (en)", async () => {
    window.localStorage.setItem(
      QUIZ_PROGRESS_STORAGE_KEY,
      JSON.stringify({ schema_version: "kpop-quiz-progress-v0", session_id: "x" }),
    );
    mockSessionFetch();
    render(<Quiz locale="en" />);
    expect(await screen.findByText(/saved progress is invalid/i)).toBeInTheDocument();
    await waitForSetupReady("Set up your game");
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect(await screen.findByRole("heading", { name: enSession.questions[0]!.prompt })).toBeInTheDocument();
  });

  it("warns when session identity drifts and still allows a new round", async () => {
    const foreign = {
      ...(ptSession as QuizSession),
      session_id: "d".repeat(64),
    };
    const save = buildQuizProgressSave({
      session: foreign,
      sessionSource: "published",
      locale: "pt-BR",
      playMode: "standard",
      theme: "history",
      decades: [],
      timerEnabled: false,
      machineState: "question.ready",
      questionIndex: 0,
      selectedId: null,
      timedOut: false,
      score: 0,
      revealedClues: [],
      history: [],
      questionDeadlineMs: null,
      startedAtMs: Date.now(),
      elapsedSeconds: 0,
      gaveUp: false,
      replayNotice: null,
    });
    saveQuizProgress(save);
    mockSessionFetch();
    render(<Quiz locale="pt-BR" />);
    expect(await screen.findByText(/não combina com os dados atuais/i)).toBeInTheDocument();
    expect(screen.getByTestId("game-start")).toBeEnabled();
  });
});

