import { act, cleanup, fireEvent, render, within } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapPilotGame, NEXT_GUARD_MS } from "./MapPilotGame";
import { mapShareText, readableScheduleLocator, RESULT_GUARD_MS } from "./MapPilotResult";
import { mapPilotStorageKey } from "./map-pilot-save";
import {
  mapPilotCountries,
  mapPilotCountryLabel,
  mapPilotEvents,
  selectMapPilotRound,
  type MapPilotEvent,
} from "../../data/map-pilot";
import { PLAYER_STATS_STORAGE_KEY } from "../../lib/player-stats";

const DATE = "2026-09-24";
const round = selectMapPilotRound(mapPilotEvents, DATE);

// Next and the result buttons ignore activation for 300 ms after they
// appear; the tests move this clock instead of waiting.
let now = 1_000;
function advanceClock(ms = Math.max(NEXT_GUARD_MS, RESULT_GUARD_MS)) {
  now += ms;
}

// jsdom has no default action for Enter; a browser clicks the button unless
// a keydown handler cancels it.
function pressEnter(target: HTMLElement, repeat = false) {
  if (fireEvent.keyDown(target, { key: "Enter", code: "Enter", repeat })) fireEvent.click(target);
}

function label(iso: string, locale: "pt-BR" | "en" = "pt-BR"): string {
  return mapPilotCountryLabel(mapPilotCountries.find((country) => country.iso_3166_1 === iso)!, locale);
}

function wrongFor(event: MapPilotEvent): MapPilotEvent {
  return mapPilotEvents.find((candidate) => candidate.country_iso_3166_1 !== event.country_iso_3166_1)!;
}

function liveRegion(container: Element): HTMLElement {
  return container.querySelector(".game-actions-message") as HTMLElement;
}

type View = ReturnType<typeof render>;

function answer(view: View, iso: string) {
  fireEvent.click(view.getByTestId(`answer-country-${iso}`));
}

function next(view: View, name = "Próxima data") {
  advanceClock();
  fireEvent.click(view.getByRole("button", { name }));
}

/** Plays the whole round; `wrongAt` lists the dates answered wrong. */
function playRound(view: View, wrongAt: number[] = []) {
  for (const [index, event] of round.entries()) {
    answer(view, wrongAt.includes(index) ? wrongFor(event).country_iso_3166_1 : event.country_iso_3166_1);
    next(view, index === round.length - 1 ? "Ver resultado" : "Próxima data");
  }
}

function save(value: unknown, date = DATE) {
  localStorage.setItem(mapPilotStorageKey(date), JSON.stringify(value));
}

function stored(date = DATE): unknown {
  const raw = localStorage.getItem(mapPilotStorageKey(date));
  return raw === null ? null : JSON.parse(raw);
}

const eventIds = round.map((event) => event.event_mbid);
const rightAnswers = round.map((event) => event.map_feature_id);

beforeEach(() => {
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("map pilot game", () => {
  it("shows a source-linked correct answer and finishes a complete round", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const { getByRole, getByText, queryByRole } = view;

    expect(getByRole("heading", { level: 2 }).textContent).toContain("Em qual país");
    expect(getByText("Pergunta 1 de 10")).toBeTruthy();

    for (const [index, event] of round.entries()) {
      answer(view, event.country_iso_3166_1);
      expect(getByRole("status").textContent).toContain("Resposta correta.");
      const links = Array.from(document.querySelectorAll(".map-pilot-evidence a")) as HTMLAnchorElement[];
      expect(links.map((link) => link.href)).toContain(event.source_url);
      expect(links.map((link) => link.href)).toContain(event.musicbrainz_event_url);
      next(view, index === round.length - 1 ? "Ver resultado" : "Próxima data");
    }

    const title = getByRole("heading", { name: "Rodada concluída" });
    expect(title).toHaveAccessibleDescription("10 de 10 certas.");
    expect(queryByRole("button", { name: "Próxima data" })).toBeNull();
  });

  it("reveals the right answer after an incorrect selection", () => {
    const [event] = round;
    const wrong = wrongFor(event!);
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    answer(view, wrong.country_iso_3166_1);
    const status = view.getByRole("status");
    expect(status.textContent).toContain("Essa não é a resposta.");
    expect(status.textContent).toContain("País correto");
    expect(status.textContent).toContain(label(event!.country_iso_3166_1));
    expect(status.textContent).toContain(`Sua resposta: ${label(wrong.country_iso_3166_1)}`);
    expect(view.container.querySelector(".game-actions")).toHaveClass("is-incorrect");
  });

  it("keeps the next action in the action bar and focuses it after an answer", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    expect(view.getByRole("status").textContent).toContain("Escolha um país destacado");
    answer(view, round[0]!.country_iso_3166_1);
    const nextButton = view.getByRole("button", { name: "Próxima data" });
    const status = view.getByRole("status");
    // The live region is the message, not the whole bar with its button.
    expect(status.classList.contains("game-actions-message")).toBe(true);
    expect(status.contains(nextButton)).toBe(false);
    expect(nextButton.closest(".game-actions")).toBe(status.closest(".game-actions"));
    expect(document.activeElement).toBe(nextButton);
    next(view);
    expect(view.getByRole("status").textContent).toContain("Escolha um país destacado");
    expect(view.getByText("Pergunta 2 de 10")).toBeTruthy();
  });

  it("focuses the result title when the round ends", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    playRound(view);
    const title = view.getByRole("heading", { name: "Rodada concluída" });
    expect(title.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(title);
    // The result sits in the action bar, and the live region stays mounted there.
    expect(title.closest(".game-actions")).toBe(liveRegion(view.container).closest(".game-actions"));
  });

  it("chooses the daily round after mount so the server HTML matches the first client render", async () => {
    const { findByText, getByRole } = render(<MapPilotGame locale="en" />);
    expect(await findByText("Question 1 of 10")).toBeTruthy();
    expect(getByRole("heading", { level: 2 }).textContent).toContain("Which country");
  });

  it("answers from the map with Enter on a highlighted country", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const path = view.container.querySelector(`path[aria-label="${label(round[0]!.country_iso_3166_1)}"]`) as SVGPathElement;
    expect(path.getAttribute("role")).toBe("button");
    expect(path.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(path, { key: "Enter" });
    expect(view.getByRole("status").textContent).toContain("Resposta correta.");
    expect(path.getAttribute("aria-pressed")).toBe("true");
    expect(path.getAttribute("tabindex")).toBe("-1");
  });
});

describe("map pilot next date guard", () => {
  it("ignores Next for 300 ms after the answer, so a double tap does not skip the verdict", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    answer(view, round[0]!.country_iso_3166_1);
    const nextButton = view.getByRole("button", { name: "Próxima data" });
    now += NEXT_GUARD_MS - 1;
    fireEvent.click(nextButton);
    expect(view.getByText("Pergunta 1 de 10")).toBeTruthy();
    now += 1;
    fireEvent.click(nextButton);
    expect(view.getByText("Pergunta 2 de 10")).toBeTruthy();
  });

  it("ignores a held Enter on Next and advances on a new press", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    answer(view, round[0]!.country_iso_3166_1);
    advanceClock();
    const nextButton = view.getByRole("button", { name: "Próxima data" });
    pressEnter(nextButton, true);
    expect(view.getByText("Pergunta 1 de 10")).toBeTruthy();
    pressEnter(nextButton);
    expect(view.getByText("Pergunta 2 de 10")).toBeTruthy();
  });
});

describe("map pilot country list and select", () => {
  it("lists the countries in alphabetical order of the page's language", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const names = Array.from(view.container.querySelectorAll(".map-pilot-country")).map((button) => button.textContent!);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "pt-BR")));
    const options = Array.from(view.container.querySelectorAll(".map-pilot-select option")).slice(1).map((option) => option.textContent);
    expect(options).toEqual(names);
    expect(view.getByRole("group", { name: "Países desta rodada" })).toBeTruthy();
  });

  it("answers from the select only after Answer is pressed", () => {
    const view = render(<MapPilotGame locale="en" seedDate={DATE} />);
    const select = view.getByRole("combobox", { name: "Countries in this round" }) as HTMLSelectElement;
    const submit = view.getByRole("button", { name: "Answer" });
    expect(select.value).toBe("");
    expect(submit).toBeDisabled();
    const wrong = wrongFor(round[0]!);
    fireEvent.change(select, { target: { value: wrong.map_feature_id } });
    expect(view.getByRole("status").textContent).toContain("Choose a highlighted country");
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(view.getByRole("status").textContent).toContain(`Your answer: ${label(wrong.country_iso_3166_1, "en")}`);
    expect(view.queryByRole("combobox")).toBeNull();
    const nextButton = view.getByRole("button", { name: "Next date" });
    expect(document.activeElement).toBe(nextButton);
    // Next takes Answer's place, so the second tap of a double tap is ignored.
    fireEvent.click(nextButton);
    expect(view.getByText("Question 1 of 10")).toBeTruthy();
  });

  it("clears the select for the next date", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const select = view.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: round[0]!.map_feature_id } });
    fireEvent.click(view.getByRole("button", { name: "Responder" }));
    next(view);
    expect((view.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    expect(view.getByRole("button", { name: "Responder" })).toBeDisabled();
  });
});

describe("map pilot saved progress", () => {
  it("does not save an untouched round", () => {
    render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    expect(stored()).toBeNull();
  });

  it("saves the events, the answers and the date on screen after each step", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const wrong = wrongFor(round[0]!);
    answer(view, wrong.country_iso_3166_1);
    expect(stored()).toEqual({ events: eventIds, answers: [wrong.map_feature_id], index: 0 });
    next(view);
    expect(stored()).toEqual({ events: eventIds, answers: [wrong.map_feature_id], index: 1 });
  });

  it("resumes an answered date without moving focus", () => {
    save({ events: eventIds, answers: rightAnswers.slice(0, 3), index: 2 });
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    expect(view.getByText("Pergunta 3 de 10")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("Resposta correta.");
    expect(document.activeElement).toBe(document.body);
    // A restored answer has no double tap to guard against.
    fireEvent.click(view.getByRole("button", { name: "Próxima data" }));
    expect(view.getByText("Pergunta 4 de 10")).toBeTruthy();
  });

  it("resumes an unanswered date", () => {
    save({ events: eventIds, answers: rightAnswers.slice(0, 4), index: 4 });
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    expect(view.getByText("Pergunta 5 de 10")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("Escolha um país destacado");
    expect(view.getByTestId(`answer-country-${round[4]!.country_iso_3166_1}`)).toBeEnabled();
  });

  it("restores a finished round's result without taking focus or touching the stats", () => {
    const answers = [...rightAnswers];
    answers[1] = wrongFor(round[1]!).map_feature_id;
    save({ events: eventIds, answers, index: 10 });
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const title = view.getByRole("heading", { name: "Rodada concluída" });
    expect(title).toHaveAccessibleDescription("9 de 10 certas.");
    expect(document.activeElement).toBe(document.body);
    expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBeNull();
  });

  it("does not record the round in the shared statistics", () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    playRound(view);
    expect(localStorage.getItem(PLAYER_STATS_STORAGE_KEY)).toBeNull();
  });

  const invalid: Array<[string, () => void]> = [
    ["malformed JSON", () => localStorage.setItem(mapPilotStorageKey(DATE), "{")],
    ["an array", () => save([])],
    ["events of another round", () => save({ events: [...eventIds].reverse(), answers: [], index: 0 })],
    ["fewer events", () => save({ events: eventIds.slice(1), answers: [], index: 0 })],
    ["a feature outside the countries", () => save({ events: eventIds, answers: ["ATA"], index: 1 })],
    ["a non-string answer", () => save({ events: eventIds, answers: [3], index: 1 })],
    ["answers ahead of the date", () => save({ events: eventIds, answers: rightAnswers.slice(0, 3), index: 1 })],
    ["answers behind the date", () => save({ events: eventIds, answers: rightAnswers.slice(0, 1), index: 3 })],
    ["an index past the round", () => save({ events: eventIds, answers: rightAnswers, index: 11 })],
    ["a fractional index", () => save({ events: eventIds, answers: rightAnswers.slice(0, 2), index: 1.5 })],
  ];
  for (const [name, write] of invalid) {
    it(`drops a save with ${name}`, () => {
      write();
      const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
      expect(view.getByText("Pergunta 1 de 10")).toBeTruthy();
      expect(view.getByRole("status").textContent).toContain("Escolha um país destacado");
    });
  }

  it("keeps each day's round under its own key", () => {
    save({ events: eventIds, answers: rightAnswers, index: 10 }, "2026-09-23");
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    expect(view.getByText("Pergunta 1 de 10")).toBeTruthy();
  });
});

describe("map pilot result", () => {
  const original = {
    share: Object.getOwnPropertyDescriptor(navigator, "share"),
    clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  };

  function setNavigator(key: "share" | "clipboard", value: unknown) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }

  beforeEach(() => {
    setNavigator("share", undefined);
  });

  afterEach(() => {
    for (const key of ["share", "clipboard"] as const) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    }
  });

  const oneWrong = rightAnswers.map((id, i) => (i === 1 ? wrongFor(round[1]!).map_feature_id : id));

  function finished() {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    playRound(view, [1]);
    return view;
  }

  async function share(view: View) {
    advanceClock();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Compartilhar resultado" }));
    });
  }

  it("builds a short share text with the round date", () => {
    expect(mapShareText(DATE, round, oneWrong, "pt-BR")).toBe(
      `K-pop Map ${DATE}\n9/10 datas certas\n🟩🟥${"🟩".repeat(8)}`,
    );
    expect(mapShareText(DATE, round, rightAnswers, "en")).toBe(`K-pop Map ${DATE}\n10/10 dates right\n${"🟩".repeat(10)}`);
  });

  it("uses the share sheet first and does not copy", async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", shareFn);
    setNavigator("clipboard", { writeText });
    const view = finished();
    await share(view);
    expect(shareFn).toHaveBeenCalledWith({ text: mapShareText(DATE, round, oneWrong, "pt-BR") });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats a closed share sheet as no error", async () => {
    setNavigator("share", vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" })));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const view = finished();
    await share(view);
    expect(writeText).not.toHaveBeenCalled();
    expect(view.container.querySelector("textarea")).toBeNull();
    expect(liveRegion(view.container)).toBeEmptyDOMElement();
  });

  it("copies the result when there is no share sheet and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const view = finished();
    await share(view);
    expect(writeText).toHaveBeenCalledWith(mapShareText(DATE, round, oneWrong, "pt-BR"));
    expect(liveRegion(view.container)).toHaveTextContent("Resultado copiado.");
    expect(view.getByRole("button", { name: "Resultado copiado." })).toBeTruthy();
  });

  it("shows the text to copy by hand when the clipboard refuses", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const view = finished();
    await share(view);
    const failed = "Não deu para copiar. Selecione o texto abaixo e copie.";
    expect(liveRegion(view.container)).toHaveTextContent(failed);
    const field = view.getByRole("textbox", { name: "Texto do resultado" }) as HTMLTextAreaElement;
    expect(field).toHaveAttribute("readonly");
    expect(field.value).toBe(mapShareText(DATE, round, oneWrong, "pt-BR"));
    expect(field).toHaveAccessibleDescription(failed);
  });

  it("ignores the result buttons for 300 ms and a held Enter", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    playRound(view);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Compartilhar resultado" }));
      fireEvent.click(view.getByRole("button", { name: "Jogar outra rodada" }));
      fireEvent.click(view.getByRole("button", { name: "Ver fonte" }));
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(view.getByRole("heading", { name: "Rodada concluída" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Ver fonte" })).toHaveAttribute("aria-expanded", "false");
    advanceClock();
    pressEnter(view.getByRole("button", { name: "Jogar outra rodada" }), true);
    expect(view.getByRole("heading", { name: "Rodada concluída" })).toBeTruthy();
  });

  it("starts the round again, clears the save and focuses the first question", () => {
    const view = finished();
    advanceClock();
    fireEvent.click(view.getByRole("button", { name: "Jogar outra rodada" }));
    expect(view.getByText("Pergunta 1 de 10")).toBeTruthy();
    expect(stored()).toBeNull();
    const question = view.getByRole("heading", { level: 2 });
    expect(question.textContent).toContain("Em qual país");
    expect(document.activeElement).toBe(question);
  });

  it("lists every date with both answers and its sources behind Ver fonte", () => {
    const view = finished();
    advanceClock();
    const toggle = view.getByRole("button", { name: "Ver fonte" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Ocultar fonte");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).not.toHaveAttribute("hidden");
    const items = Array.from(panel.querySelectorAll("li.review-item")) as HTMLElement[];
    expect(items).toHaveLength(10);

    const wrongEvent = round[1]!;
    const second = items[1]!;
    expect(second).toHaveClass("is-wrong");
    expect(second).toHaveTextContent("Errada");
    expect(second).toHaveTextContent(`País correto: ${label(wrongEvent.country_iso_3166_1)}`);
    expect(second).toHaveTextContent(`Sua resposta: ${label(wrongFor(wrongEvent).country_iso_3166_1)}`);
    const hrefs = within(second).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      wrongEvent.source_url,
      wrongEvent.musicbrainz_event_url,
      `https://www.wikidata.org/w/index.php?oldid=${wrongEvent.country_check_wikidata_revid}`,
    ]);
    expect(second).toHaveTextContent(`revisão ${wrongEvent.country_check_wikidata_revid}`);
    expect(second).toHaveTextContent(`Local na fonte: ${readableScheduleLocator(wrongEvent.source_locator, wrongEvent.event_date)}`);
    expect(second).toHaveTextContent("Conferida em");
    expect(items[0]).toHaveClass("is-correct");
    expect(items[0]).toHaveTextContent("Certa");

    fireEvent.click(toggle);
    expect(panel).toHaveAttribute("hidden");
    expect(toggle).toHaveTextContent("Ver fonte");
  });

  it("reads the schedule locator without the repeated date", () => {
    expect(readableScheduleLocator("GOYANG > GOYANG STADIUM > 2025-07-05", "2025-07-05")).toBe("GOYANG, GOYANG STADIUM");
    expect(readableScheduleLocator("GOYANG > GOYANG STADIUM", "2025-07-05")).toBe("GOYANG, GOYANG STADIUM");
    expect(readableScheduleLocator("", "2025-07-05")).toBe("");
  });

  it("has no axe violations while playing, answered and at the end", async () => {
    const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    expect((await axe.run(view.container)).violations).toEqual([]);
    answer(view, wrongFor(round[0]!).country_iso_3166_1);
    expect((await axe.run(view.container)).violations).toEqual([]);
    next(view);
    for (const [index, event] of round.slice(1).entries()) {
      answer(view, event.country_iso_3166_1);
      next(view, index === round.length - 2 ? "Ver resultado" : "Próxima data");
    }
    advanceClock();
    fireEvent.click(view.getByRole("button", { name: "Ver fonte" }));
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
