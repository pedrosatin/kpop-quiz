import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapPilotCountries,
  mapPilotCountryLabel,
  mapPilotEvents,
  mapPilotFeatures,
  selectMapPilotRound,
  type MapPilotEvent,
} from "../../data/map-pilot";
import { getMessages } from "../../i18n/catalog";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";
import type { Locale } from "../../lib/quiz-types";
import { MapPilotGame } from "./MapPilotGame";
import { mapShareText } from "./MapPilotResult";
import { MAP_PILOT_COPY } from "./map-pilot-copy";
import { featureShape } from "./map-pilot-geometry";
import { mapPilotStorageKey } from "./map-pilot-save";
import { MAP_ZOOM_QUERY } from "./useMapBox";

// Pins the rendered DOM, the focused element, the stored data and the
// analytics events of every Map state, so splitting the game can be checked
// against the code it replaces.

const DATE = "2026-09-24";
const round = selectMapPilotRound(mapPilotEvents, DATE);
const eventIds = round.map((event) => event.event_mbid);
const rightAnswers = round.map((event) => event.map_feature_id);
const storageKey = mapPilotStorageKey(DATE);

// The world map paths add up to hundreds of kilobytes; each one is named by
// its feature id instead, which still pins which country every path draws.
const pathIds = new Map(mapPilotFeatures.map((feature) => [feature.path, feature.id]));

function normalizedHtml(container: Element): string {
  return container.innerHTML.replace(/ d="([^"]*)"/g, (_match, path: string) => ` d="@${pathIds.get(path) ?? path}"`);
}

function describeFocus(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "body";
  const id = element.id ? `#${element.id}` : "";
  const className = element.getAttribute("class") ?? "";
  const name = element.getAttribute("aria-label") ?? element.textContent;
  return `${element.tagName.toLowerCase()}${id}.${className.split(" ").join(".")} ${JSON.stringify(name)}`;
}

/** Every stored key, sorted, so the save and the recorded match both show. */
function storage(): Record<string, string | null> {
  const keys = Object.keys(localStorage).sort();
  return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
}

/** The game as the player meets it: markup, focus and what is stored. */
function capture(container: Element) {
  return {
    html: normalizedHtml(container),
    focus: describeFocus(),
    storage: storage(),
  };
}

function store(save: unknown, date = DATE) {
  localStorage.setItem(mapPilotStorageKey(date), JSON.stringify(save));
}

function wrongFor(event: MapPilotEvent): MapPilotEvent {
  return mapPilotEvents.find((candidate) => candidate.country_iso_3166_1 !== event.country_iso_3166_1)!;
}

function label(featureId: string, locale: Locale): string {
  return mapPilotCountryLabel(mapPilotCountries.find((country) => country.map_feature_id === featureId)!, locale);
}

// Next, the result buttons and the zoom ignore activation for 300 ms after
// they appear; the tests move this clock instead of waiting.
let now = 1_000;
function advanceClock(ms = 400) {
  now += ms;
}

/** Focuses a button, as a press does, then clicks it. */
function press(button: HTMLElement) {
  button.focus();
  fireEvent.click(button);
}

function pressNamed(name: string) {
  press(screen.getByRole("button", { name }));
}

function listButton(featureId: string): HTMLElement {
  const country = mapPilotCountries.find((candidate) => candidate.map_feature_id === featureId)!;
  return screen.getByTestId(`answer-country-${country.iso_3166_1}`);
}

function countryPath(container: Element, featureId: string, locale: Locale): SVGPathElement {
  return container.querySelector(`path[aria-label="${label(featureId, locale)}"]`) as SVGPathElement;
}

function worldMap(container: Element): SVGSVGElement {
  return container.querySelector(".map-pilot-world-map") as SVGSVGElement;
}

function target(container: Element, featureId: string): SVGCircleElement {
  return container.querySelector(`.map-pilot-target[data-feature="${featureId}"]`) as SVGCircleElement;
}

function chooseInSelect(featureId: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: featureId } });
}

/** Picks a country from the list and presses Answer. */
function answerWith(locale: Locale, featureId: string) {
  press(listButton(featureId));
  pressNamed(MAP_PILOT_COPY[locale].answer);
}

function nextDate(locale: Locale, index: number) {
  advanceClock();
  const copy = MAP_PILOT_COPY[locale];
  pressNamed(index === round.length - 1 ? copy.finish : copy.next);
}

/** Answers the dates from `from` to the end; `wrongAt` lists the ones answered wrong. */
function playFrom(locale: Locale, from: number, wrongAt: number[] = []) {
  for (let index = from; index < round.length; index++) {
    const event = round[index]!;
    answerWith(locale, wrongAt.includes(index) ? wrongFor(event).map_feature_id : event.map_feature_id);
    nextDate(locale, index);
  }
}

// A 360px phone: the map box is 300x180, so the whole map is drawn at
// 0.25px per unit with 30px of sea above and below it.
const PHONE_MAP = { left: 20, top: 400, width: 300, height: 180 };
// A 1440px screen: the map beside the list, at 0.54px per unit.
const DESKTOP_MAP = { left: 100, top: 200, width: 644, height: 258 };

const layout = {
  narrow: false,
  listeners: new Set<() => void>(),
  set(narrow: boolean) {
    this.narrow = narrow;
    act(() => this.listeners.forEach((listener) => listener()));
  },
};

function measuredMap(map: typeof PHONE_MAP, narrow: boolean) {
  layout.narrow = narrow;
  layout.listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === MAP_ZOOM_QUERY && layout.narrow;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => layout.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => layout.listeners.delete(listener),
  }));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  const measure = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (!this.classList.contains("map-pilot-world-map")) return measure.call(this);
    const { left, top, width, height } = map;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
}

/** A finger or a mouse: pointerdown, then a click that counts one press. */
function tap(element: Element, init: MouseEventInit = {}) {
  fireEvent.pointerDown(element, init);
  fireEvent.click(element, { detail: 1, ...init });
}

/** A tap on the whole map of PHONE_MAP at a map point. */
function tapWorld(container: Element, x: number, y: number) {
  tap(worldMap(container), {
    clientX: PHONE_MAP.left + x * 0.25,
    clientY: PHONE_MAP.top + 30 + (y - 20) * 0.25,
  });
}

function anchorOf(featureId: string) {
  return featureShape(mapPilotFeatures.find((candidate) => candidate.id === featureId)!.path).anchor;
}

function setNavigator(key: "share" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}

const original = {
  share: Object.getOwnPropertyDescriptor(navigator, "share"),
  clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  scrollIntoView: Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView"),
};

/** Presses Share, whose label reads "copied" after a copy. */
async function pressShare() {
  advanceClock();
  const button = document.querySelector<HTMLButtonElement>(".map-pilot-result-buttons .btn-primary")!;
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
}

/** Lets the dialog's delayed focus and pending promises run. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await act(async () => {});
}

let gtag = vi.fn();
const scrolled: string[] = [];

beforeEach(() => {
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DATE}T15:00:00Z`));
  scrolled.length = 0;
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element) {
      scrolled.push(`${this.tagName.toLowerCase()}.${(this.getAttribute("class") ?? "").split(" ").join(".")}`);
    },
  });
  gtag = vi.fn();
  vi.stubGlobal("gtag", gtag);
  setGameAnalyticsConsent("G-TEST", true);
  setNavigator("share", undefined);
});

afterEach(() => {
  cleanup();
  setGameAnalyticsConsent("", false);
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of ["share", "clipboard"] as const) {
    const descriptor = original[key];
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
  if (original.scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", original.scrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("map characterization", () => {
  it.each(["pt-BR", "en"] as const)("plays, finishes and shares a round on a wide screen in %s", async (locale: Locale) => {
    const messages = getMessages(locale);
    const copy = MAP_PILOT_COPY[locale];
    measuredMap(DESKTOP_MAP, false);
    const { container } = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    expect(capture(container)).toMatchSnapshot("01 initial");

    pressNamed(copy.answer);
    expect(capture(container)).toMatchSnapshot("02 Answer with no country");

    pressNamed(copy.answer);
    expect(capture(container)).toMatchSnapshot("03 Answer with no country again");

    const first = round[0]!;
    press(listButton(wrongFor(first).map_feature_id));
    expect(capture(container)).toMatchSnapshot("04 country picked from the list");

    const firstPath = countryPath(container, first.map_feature_id, locale);
    firstPath.focus();
    fireEvent.keyDown(firstPath, { key: "Enter" });
    expect(capture(container)).toMatchSnapshot("05 country picked on the map with Enter");

    // Singapore is too small to click on the whole map: its dot takes the click.
    fireEvent.click(target(container, "SGP"));
    expect(capture(container)).toMatchSnapshot("06 country picked from its dot");

    press(listButton(first.map_feature_id));
    pressNamed(copy.answer);
    expect(capture(container)).toMatchSnapshot("07 right answer");

    // A second tap or a held Enter meant for Answer does not skip the verdict.
    const next = screen.getByRole("button", { name: copy.next });
    fireEvent.click(next);
    fireEvent.keyDown(next, { key: "Enter", repeat: true });
    expect(capture(container)).toMatchSnapshot("08 Next ignored right after the answer");

    nextDate(locale, 0);
    expect(capture(container)).toMatchSnapshot("09 second date");

    const second = round[1]!;
    chooseInSelect(wrongFor(second).map_feature_id);
    expect(capture(container)).toMatchSnapshot("10 country picked in the select");

    pressNamed(copy.answer);
    expect(capture(container)).toMatchSnapshot("11 wrong answer");

    nextDate(locale, 1);
    for (let index = 2; index < round.length - 1; index++) {
      answerWith(locale, round[index]!.map_feature_id);
      nextDate(locale, index);
    }
    answerWith(locale, wrongFor(round[round.length - 1]!).map_feature_id);
    expect(capture(container)).toMatchSnapshot("12 last date answered");

    nextDate(locale, round.length - 1);
    await settle();
    expect(capture(container)).toMatchSnapshot("13 round finished");

    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await pressShare();
    expect(capture(container)).toMatchSnapshot("14 share copied");
    await pressShare();
    expect(capture(container)).toMatchSnapshot("15 share copied again");
    expect(writeText.mock.calls).toMatchSnapshot("15 clipboard text");

    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await pressShare();
    expect(capture(container)).toMatchSnapshot("16 share failed");

    advanceClock();
    pressNamed(messages.showSource);
    expect(capture(container)).toMatchSnapshot("17 sources open");

    advanceClock();
    pressNamed(messages.hideSource);
    expect(capture(container)).toMatchSnapshot("18 sources hidden");
    expect(scrolled).toMatchSnapshot("18 scrolled into view");

    await settle();
    expect(gtag.mock.calls).toMatchSnapshot("19 analytics events");
  });

  it.each(["pt-BR", "en"] as const)("gives up the same way in %s", async (locale: Locale) => {
    const messages = getMessages(locale);
    const { container } = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    answerWith(locale, rightAnswers[0]!);
    nextDate(locale, 0);
    press(listButton(rightAnswers[1]!));
    expect(capture(container)).toMatchSnapshot("01 one date answered and a country picked");

    pressNamed(messages.giveUp);
    await settle();
    expect(capture(container)).toMatchSnapshot("02 give-up confirmation open");

    pressNamed(messages.cancel);
    await settle();
    expect(capture(container)).toMatchSnapshot("03 give-up cancelled");

    pressNamed(messages.giveUp);
    await settle();
    pressNamed(messages.giveUpConfirmAction);
    await settle();
    expect(capture(container)).toMatchSnapshot("04 given up with the dates revealed");

    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    await pressShare();
    expect(capture(container)).toMatchSnapshot("05 shared with the share sheet");
    expect(share.mock.calls).toMatchSnapshot("05 share sheet text");

    await settle();
    expect(gtag.mock.calls).toMatchSnapshot("06 analytics events");
  });

  it.each(["pt-BR", "en"] as const)("zooms and picks on a narrow screen the same way in %s", (locale: Locale) => {
    const copy = MAP_PILOT_COPY[locale];
    measuredMap(PHONE_MAP, true);
    const { container } = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    expect(capture(container)).toMatchSnapshot("01 whole map with the zoom hint");

    // Where the finger went down sets the zoom, not where the click lands.
    const singapore = countryPath(container, "SGP", locale);
    tap(singapore, { clientX: PHONE_MAP.left + 946 * 0.25, clientY: PHONE_MAP.top + 30 + (295.5 - 20) * 0.25 });
    expect(capture(container)).toMatchSnapshot("02 zoomed by a tap");

    tap(target(container, "SGP"));
    expect(capture(container)).toMatchSnapshot("03 tap ignored right after the zoom");

    advanceClock();
    tap(target(container, "SGP"));
    expect(capture(container)).toMatchSnapshot("04 country picked from its 44px target");

    const zoomOut = screen.getByRole("button", { name: copy.zoomOut });
    press(zoomOut);
    expect(capture(container)).toMatchSnapshot("05 whole map again with Mapa inteiro");

    const france = anchorOf("FRA");
    tapWorld(container, france.x, france.y);
    fireEvent.pointerDown(worldMap(container));
    fireEvent.focus(countryPath(container, "JPN", locale));
    expect(capture(container)).toMatchSnapshot("06 zoom kept when a tap focuses a country out of view");

    fireEvent.keyDown(worldMap(container));
    fireEvent.focus(countryPath(container, "JPN", locale));
    expect(capture(container)).toMatchSnapshot("07 whole map when Tab reaches a country out of view");

    // A click with no pointer, as from a screen reader, selects without zooming.
    fireEvent.click(countryPath(container, "FRA", locale), { detail: 0 });
    expect(capture(container)).toMatchSnapshot("08 country picked by assistive technology");

    const answer = anchorOf(round[0]!.map_feature_id);
    tapWorld(container, answer.x > 600 ? 150 : 1050, 150);
    chooseInSelect(wrongFor(round[0]!).map_feature_id);
    pressNamed(copy.answer);
    expect(capture(container)).toMatchSnapshot("09 whole map when the answer is out of the zoomed view");

    tapWorld(container, answer.x > 600 ? 150 : 1050, 150);
    expect(capture(container)).toMatchSnapshot("10 zoomed again after the answer");

    nextDate(locale, 0);
    expect(capture(container)).toMatchSnapshot("11 next date starts on the whole map");

    const second = anchorOf(round[1]!.map_feature_id);
    tapWorld(container, second.x, second.y);
    chooseInSelect(round[1]!.map_feature_id);
    pressNamed(copy.answer);
    expect(capture(container)).toMatchSnapshot("12 zoom kept when the answer is in view");

    layout.set(false);
    expect(capture(container)).toMatchSnapshot("13 screen turned wide");

    nextDate(locale, 1);
    tap(countryPath(container, "FRA", locale));
    expect(capture(container)).toMatchSnapshot("14 a tap picks on the wide screen");

    layout.set(true);
    expect(capture(container)).toMatchSnapshot("15 screen turned narrow again");
  });

  it.each(["pt-BR", "en"] as const)("restores saved rounds the same way in %s", async (locale: Locale) => {
    store({ events: eventIds, answers: rightAnswers.slice(0, 2), index: 2 });
    let view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    expect(capture(view.container)).toMatchSnapshot("01 open round on an unanswered date");

    cleanup();
    store({ events: eventIds, answers: [...rightAnswers.slice(0, 2), wrongFor(round[2]!).map_feature_id], index: 2 });
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    expect(capture(view.container)).toMatchSnapshot("02 open round on an answered date");

    nextDate(locale, 2);
    expect(capture(view.container)).toMatchSnapshot("03 Next after the restored answer");

    cleanup();
    localStorage.clear();
    store({ events: eventIds, answers: rightAnswers.slice(0, 3), index: 3, replay: true });
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    expect(capture(view.container)).toMatchSnapshot("04 replay saved before Play again was removed");

    playFrom(locale, 3);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("05 replay finished, not counted");

    cleanup();
    localStorage.clear();
    store({ events: eventIds, answers: rightAnswers, index: round.length, replay: true });
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("06 restored finished replay");

    cleanup();
    localStorage.clear();
    store({ events: eventIds, answers: rightAnswers.map((id, i) => (i % 3 === 0 ? wrongFor(round[i]!).map_feature_id : id)), index: round.length });
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("07 restored finished round");

    cleanup();
    localStorage.clear();
    store({ events: eventIds, answers: rightAnswers.slice(0, 2), index: round.length, gaveUp: true });
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("08 restored give-up");

    cleanup();
    localStorage.clear();
    store({ events: eventIds, answers: rightAnswers.slice(0, 4), index: round.length });
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("09 restored round finished with fewer answers");

    cleanup();
    localStorage.removeItem(storageKey);
    view = render(<MapPilotGame locale={locale} seedDate={DATE} />);
    await settle();
    expect(capture(view.container)).toMatchSnapshot("10 day already recorded for a dropped save");
  });

  it("starts over from saves it refuses and drops the saves of other days", () => {
    const saves: unknown[] = [
      "{",
      "",
      "null",
      "3",
      [],
      {},
      { events: eventIds, answers: [], index: round.length, gaveUp: "yes" },
      { events: eventIds, answers: [], index: 0, gaveUp: true },
      { events: eventIds, answers: [], index: 0, gaveUp: false },
      { events: [...eventIds].reverse(), answers: [], index: 0 },
      { events: eventIds.slice(1), answers: [], index: 0 },
      { events: [...eventIds, "extra"], answers: [], index: 0 },
      { events: "x", answers: [], index: 0 },
      { events: eventIds, answers: ["ATA"], index: 1 },
      { events: eventIds, answers: [3], index: 1 },
      { events: eventIds, answers: "FRA", index: 0 },
      { events: eventIds, answers: rightAnswers.slice(0, 3), index: 1 },
      { events: eventIds, answers: rightAnswers.slice(0, 1), index: 3 },
      { events: eventIds, answers: rightAnswers.slice(0, 2), index: 1 },
      { events: eventIds, answers: rightAnswers, index: 11 },
      { events: eventIds, answers: rightAnswers.slice(0, 2), index: 1.5 },
      { events: eventIds, answers: rightAnswers.slice(0, 2), index: "2" },
      { events: eventIds, answers: rightAnswers.slice(0, 2), index: -1 },
      { events: eventIds, answers: [...rightAnswers, "FRA"], index: round.length },
      { events: eventIds, answers: [], index: round.length },
      { events: eventIds, answers: [], index: 0, replay: "yes" },
      { events: eventIds, answers: rightAnswers.slice(0, 1), index: 0, replay: 1, extra: true },
      { events: eventIds, answers: rightAnswers.slice(0, 1), index: 1, replay: true, gaveUp: false },
    ];
    const restored = saves.map((save) => {
      localStorage.clear();
      store({ events: eventIds, answers: rightAnswers, index: round.length }, "2026-09-23");
      localStorage.setItem("kpop-map-settings", "keep");
      if (typeof save === "string") localStorage.setItem(storageKey, save);
      else store(save);
      const view = render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
      const state = {
        progress: view.container.querySelector(".map-pilot-progress")?.textContent ?? null,
        message: view.container.querySelector(".game-actions-message")?.textContent ?? null,
        result: screen.queryByTestId("game-result")?.querySelector(".map-pilot-verdict")?.textContent ?? null,
        storage: storage(),
      };
      view.unmount();
      return state;
    });
    expect(restored).toMatchSnapshot();
  });

  it("pins the raw save written after each step", () => {
    render(<MapPilotGame locale="pt-BR" seedDate={DATE} />);
    const saves: Array<string | null> = [localStorage.getItem(storageKey)];
    press(listButton(rightAnswers[0]!));
    saves.push(localStorage.getItem(storageKey));
    pressNamed("Responder");
    saves.push(localStorage.getItem(storageKey));
    nextDate("pt-BR", 0);
    saves.push(localStorage.getItem(storageKey));
    answerWith("pt-BR", wrongFor(round[1]!).map_feature_id);
    saves.push(localStorage.getItem(storageKey));
    nextDate("pt-BR", 1);
    saves.push(localStorage.getItem(storageKey));
    pressNamed("Desistir");
    pressNamed("Sim, desistir");
    saves.push(localStorage.getItem(storageKey));
    expect(saves).toMatchSnapshot();
  });

  it("pins the share text of a win, a loss and a give-up in both languages", () => {
    const loss = round.map((event, i) => (i < 6 ? wrongFor(event).map_feature_id : event.map_feature_id));
    const gaveUp = rightAnswers.slice(0, 3);
    expect({
      wonPt: mapShareText(DATE, round, rightAnswers, "pt-BR"),
      wonEn: mapShareText(DATE, round, rightAnswers, "en"),
      lostPt: mapShareText(DATE, round, loss, "pt-BR"),
      lostEn: mapShareText(DATE, round, loss, "en"),
      gaveUpPt: mapShareText(DATE, round, gaveUp, "pt-BR"),
      gaveUpEn: mapShareText(DATE, round, gaveUp, "en"),
    }).toMatchSnapshot();
  });
});
