import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCatalogCache } from "../data/catalog-loader";
import { getMessages } from "../i18n/catalog";
import { setGameAnalyticsConsent } from "../lib/game-analytics";
import type { GameId } from "../lib/player-stats";
import type { ConnectionsPuzzle, Locale, NameGuessPuzzle, TimelinePuzzle } from "../lib/quiz-types";
import type { WordSearchPuzzle } from "../lib/word-search-types";
import { gameCounts } from "../test/match-records";
import { resetStaleDaily } from "../test/stale-daily";
import connectionsJson from "../tests/fixtures/connections.daily.json";
import gridJson from "../tests/fixtures/grid.daily.json";
import manifest from "../tests/fixtures/manifest-v2.json";
import nameGuessJson from "../tests/fixtures/name-guess.daily.json";
import enSession from "../tests/fixtures/session.en.standard.9c44914efa4be2eee52cf11ea63f542c8e913e01b5a58dc63d3627ed003e8c0e.json";
import ptSession from "../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import timelineJson from "../tests/fixtures/timeline.daily.json";
import wordSearchJson from "../tests/fixtures/word-search.daily.json";
import { ConnectionsGame } from "./Connections/ConnectionsGame";
import { IntersectionGrid } from "./Grid/IntersectionGrid";
import { NameGuessGame } from "./NameGuess/NameGuessGame";
import { Quiz } from "./Quiz/Quiz";
import { TimelineGame } from "./Timeline/TimelineGame";
import { WordSearchGame } from "./WordSearch/WordSearchGame";

// Pins the give-up confirmation of the six games that share it: the copy and
// ARIA of the dialog, where the focus goes on open, cancel and confirm, and
// that a confirm landing in the same tick as a close, or a second click on
// Confirm, ends the round at most once.

const copy = {
  "pt-BR": {
    giveUp: "Desistir",
    title: "Desistir da partida?",
    body: "Você perde o progresso desta partida.",
    cancel: "Cancelar",
    confirm: "Sim, desistir",
  },
  en: {
    giveUp: "Give up",
    title: "Give up this game?",
    body: "You will lose your progress in this game.",
    cancel: "Cancel",
    confirm: "Yes, give up",
  },
} as const;

interface GiveUpGame {
  name: string;
  gameId: GameId;
  /** Renders the board and resolves once the give-up button is on screen. */
  mount(locale: Locale): Promise<void>;
  /** The heading the result takes once the round is over. */
  resultTitle(locale: Locale): string;
}

function stubQuizFetch(): void {
  const testManifest = structuredClone(manifest) as Record<string, any>;
  for (const locale of ["pt-BR", "en"]) {
    for (const mode of ["assisted", "standard", "expert"]) {
      const general = testManifest.sessions[`${locale}.${mode}`];
      testManifest.sessions[`daily.${locale}.${mode}`] = {
        path: `session.daily.${locale}.${mode}.${general.sha256}.json`,
        sha256: general.sha256,
        session_id: general.session_id,
      };
    }
  }
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("catalog-manifest") || url.includes("/catalog.")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    if (url.endsWith("manifest-v2.json")) return Promise.resolve(new Response(JSON.stringify(testManifest)));
    const session = url.includes("pt-BR") ? ptSession : enSession;
    return Promise.resolve(new Response(`${JSON.stringify(session)}\n`));
  }));
}

const games: GiveUpGame[] = [
  {
    name: "Connections",
    gameId: "connections",
    async mount(locale) {
      render(<ConnectionsGame locale={locale} puzzle={connectionsJson as unknown as ConnectionsPuzzle} messages={getMessages(locale)} />);
    },
    resultTitle: (locale) => getMessages(locale).connectionsGameOverLost,
  },
  {
    name: "Grid",
    gameId: "grid",
    async mount(locale) {
      vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        url.includes("grid-publication.") ? new Response(null, { status: 404 }) : new Response(JSON.stringify(gridJson))));
      render(<IntersectionGrid locale={locale} messages={getMessages(locale)} />);
      await screen.findByRole("grid");
    },
    resultTitle: (locale) => getMessages(locale).resultTitle,
  },
  {
    name: "Name Guess",
    gameId: "name-guess",
    async mount(locale) {
      render(<NameGuessGame locale={locale} puzzle={nameGuessJson as unknown as NameGuessPuzzle} />);
    },
    resultTitle: (locale) => getMessages(locale).nameGuess.lostTitle,
  },
  {
    name: "Timeline",
    gameId: "timeline",
    async mount(locale) {
      render(<TimelineGame locale={locale} puzzle={timelineJson as unknown as TimelinePuzzle} />);
    },
    resultTitle: (locale) => (locale === "pt-BR" ? "Você desistiu" : "You gave up"),
  },
  {
    name: "Quiz",
    gameId: "quiz",
    async mount(locale) {
      window.history.replaceState(null, "", "/?theme=history");
      stubQuizFetch();
      render(<Quiz locale={locale} />);
      await vi.waitFor(() => expect(screen.getByTestId("game-start")).toBeEnabled());
      fireEvent.click(screen.getByTestId("game-start"));
      const session = locale === "pt-BR" ? ptSession : enSession;
      await screen.findByRole("heading", { name: session.questions[0]!.prompt });
    },
    resultTitle: (locale) => getMessages(locale).resultTitle,
  },
  {
    name: "Word Search",
    gameId: "word-search",
    async mount(locale) {
      render(<WordSearchGame locale={locale} puzzle={wordSearchJson as unknown as WordSearchPuzzle} />);
    },
    resultTitle: (locale) => getMessages(locale).resultTitle,
  },
];

function giveUpButton(locale: Locale): HTMLElement {
  return screen.getByRole("button", { name: copy[locale].giveUp });
}

/** Opens the dialog from a focused give-up button and waits for Cancel to take the focus. */
async function openConfirm(locale: Locale): Promise<HTMLElement> {
  const trigger = giveUpButton(locale);
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: copy[locale].title });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: copy[locale].cancel })).toHaveFocus());
  return dialog;
}

function expectRoundGoesOn(game: GiveUpGame, locale: Locale): void {
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: game.resultTitle(locale) })).not.toBeInTheDocument();
  expect(giveUpButton(locale)).toBeInTheDocument();
}

describe.each(games)("$name give-up confirmation", (game) => {
  beforeEach(() => {
    localStorage.clear();
    clearCatalogCache();
  });

  afterEach(() => {
    setGameAnalyticsConsent("", false);
    resetStaleDaily();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    clearCatalogCache();
  });

  it.each(["pt-BR", "en"] as const)("names and describes the modal dialog in %s", async (locale) => {
    await game.mount(locale);
    const dialog = await openConfirm(locale);

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(copy[locale].title);
    expect(dialog).toHaveAccessibleDescription(copy[locale].body);
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(copy[locale].title);
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual([
      copy[locale].cancel,
      copy[locale].confirm,
    ]);
  });

  it("gives the focus back to the give-up button on Cancel and keeps the round", async () => {
    await game.mount("pt-BR");
    const dialog = await openConfirm("pt-BR");

    fireEvent.click(within(dialog).getByRole("button", { name: copy["pt-BR"].cancel }));

    expectRoundGoesOn(game, "pt-BR");
    expect(giveUpButton("pt-BR")).toHaveFocus();
  });

  it("gives the focus back to the give-up button on Escape and keeps the round", async () => {
    await game.mount("pt-BR");
    await openConfirm("pt-BR");

    fireEvent.keyDown(window, { key: "Escape" });

    expectRoundGoesOn(game, "pt-BR");
    expect(giveUpButton("pt-BR")).toHaveFocus();
  });

  it("closes the dialog and ends the round on confirm, with the focus on the result title", async () => {
    await game.mount("pt-BR");
    const dialog = await openConfirm("pt-BR");

    fireEvent.click(within(dialog).getByRole("button", { name: copy["pt-BR"].confirm }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const title = await screen.findByRole("heading", { name: game.resultTitle("pt-BR") });
    await waitFor(() => expect(title).toHaveFocus());
    expect(gameCounts(game.gameId)).toEqual({ played: 1, won: 0 });
  });

  it("gives up once when Confirm is clicked twice in the same tick", async () => {
    await game.mount("pt-BR");
    const confirm = within(await openConfirm("pt-BR")).getByRole("button", { name: copy["pt-BR"].confirm });

    act(() => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: game.resultTitle("pt-BR") })).toBeInTheDocument();
    expect(gameCounts(game.gameId)).toEqual({ played: 1, won: 0 });
  });

  it("ignores a Confirm that lands in the same tick as Cancel", async () => {
    await game.mount("pt-BR");
    const dialog = await openConfirm("pt-BR");
    const cancel = within(dialog).getByRole("button", { name: copy["pt-BR"].cancel });
    const confirm = within(dialog).getByRole("button", { name: copy["pt-BR"].confirm });

    act(() => {
      cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expectRoundGoesOn(game, "pt-BR");
    expect(gameCounts(game.gameId)).toEqual({ played: 0, won: 0 });
  });

  it("ignores a Confirm that lands in the same tick as Escape", async () => {
    await game.mount("pt-BR");
    const confirm = within(await openConfirm("pt-BR")).getByRole("button", { name: copy["pt-BR"].confirm });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expectRoundGoesOn(game, "pt-BR");
    expect(gameCounts(game.gameId)).toEqual({ played: 0, won: 0 });
  });
});
