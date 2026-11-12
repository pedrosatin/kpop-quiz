/**
 * Room for the sticky .game-actions bar.
 *
 * On phones the bar is sticky at the foot of the screen, above the consent
 * banner, and covers the end of the card while the card is taller than the
 * screen. The .game-layout games (grid, connections, name guess,
 * crossword) drop the sticky bar from 60rem; the others keep it at every
 * width. The bar's height changes with its message, so no fixed budget fits
 * every state. This module measures the bar while it is sticky and:
 *
 * - publishes its height as --game-actions-height on the root. components.css
 *   turns it into scroll-margin-bottom for the page content outside the bar
 *   and outside dialogs, on top of the root scroll padding, which covers only
 *   the consent banner, so focus and scrollIntoView stop above the bar;
 * - when the stuck bar grows (a message of several lines), scrolls the page
 *   by what the bar took, so whatever was above the bar stays above it;
 * - scrolls a focused element that sits behind the bar or the banner into
 *   view, also after a tap, which does not scroll by itself.
 *
 * A bar that is not sticky (side panel from 60rem, an open source panel)
 * publishes nothing and is left alone.
 *
 * Only what can change the bar is watched: bars mounting or unmounting,
 * attribute changes inside a bar (an open source panel turns it static),
 * its size, the banner's height on the root style, scrolling and the window
 * size. Class changes on the board (each move of a drag) are not.
 */

export const GAME_ACTIONS_HEIGHT_VAR = "--game-actions-height";

const BAR_SELECTOR = ".game-actions";
/**
 * Focus inside these never needs room above the bar: the bar itself, the
 * banner, and dialogs, which scroll their own lists. components.css leaves
 * the same elements without the scroll margin.
 */
export const OUTSIDE_PLAY_SELECTOR = '.game-actions, .consent-banner, dialog, [role="dialog"]';
/** Attributes that open or close a panel inside a bar and so its stickiness. */
const BAR_ATTRIBUTES = ["class", "hidden", "open"];
/** Rounding slack for fractional layout. */
const EPSILON = 0.5;

/** The first rendered .game-actions bar that is sticky, or null. */
export function findStickyBar(doc: Document): HTMLElement | null {
  const view = doc.defaultView;
  if (!view) return null;
  for (const bar of doc.querySelectorAll<HTMLElement>(BAR_SELECTOR)) {
    if (bar.getClientRects().length > 0 && view.getComputedStyle(bar).position === "sticky") return bar;
  }
  return null;
}

/**
 * How far the page must scroll so that what sat just above the bar before it
 * grew sits just above it again. Zero unless the bar grew and its top moved up.
 */
export function growthScroll(
  before: { top: number; height: number },
  after: { top: number; height: number },
): number {
  if (after.height <= before.height + EPSILON) return 0;
  const lost = before.top - after.top;
  return lost > EPSILON ? lost : 0;
}

/**
 * True when the element's box reaches below the visible edge (the top of the
 * bar, or of the banner when it is higher) while it still fits above that edge.
 * Elements taller than the room are left where they are: scrolling them
 * would only trade the bottom for the top.
 */
export function coveredAtBottom(rect: { top: number; bottom: number; height: number }, visibleBottom: number): boolean {
  return rect.bottom > visibleBottom + EPSILON && rect.height <= visibleBottom;
}

function bannerTop(doc: Document, view: Window): number {
  const banner = doc.querySelector(".consent-banner");
  return banner ? banner.getBoundingClientRect().top : view.innerHeight;
}

/** Writes the bar height on the root; returns the value now published. */
function publishHeight(root: HTMLElement, height: number, published: string): string {
  const value = height > 0 ? `${Math.ceil(height)}px` : "";
  if (value === published) return published;
  if (value) root.style.setProperty(GAME_ACTIONS_HEIGHT_VAR, value);
  else root.style.removeProperty(GAME_ACTIONS_HEIGHT_VAR);
  return value;
}

function measure(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  return { top: rect.top, height: rect.height };
}

function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

/** True when a mutation batch mounts or unmounts a bar; other nodes cost no layout. */
export function mountsOrUnmountsBar(records: readonly MutationRecord[]): boolean {
  const touchesBar = (nodes: NodeList) => Array.from(nodes).some((node) => node.nodeType === Node.ELEMENT_NODE
    && ((node as Element).matches(BAR_SELECTOR) || (node as Element).querySelector(BAR_SELECTOR) !== null));
  return records.some((record) => touchesBar(record.addedNodes) || touchesBar(record.removedNodes));
}

/** Scrolls the focused target into view when the bar or the banner covers its foot. */
function revealIfCovered(target: Element, bar: HTMLElement | null, doc: Document, view: Window) {
  if (!bar || doc.activeElement !== target || target.contains(bar)) return;
  const edge = Math.min(bar.getBoundingClientRect().top, bannerTop(doc, view));
  if (coveredAtBottom(target.getBoundingClientRect(), edge)) target.scrollIntoView({ block: "nearest" });
}

/**
 * Starts tracking the sticky bar in doc. Returns a function that stops it
 * and removes the published height.
 */
export function installStickyBarSpace(doc: Document = document): () => void {
  const view = doc.defaultView;
  if (!view) return () => {};
  const root = doc.documentElement;

  let bar: HTMLElement | null = null;
  let last = { top: 0, height: 0 };
  let published = "";
  let focusFrame = 0;

  const publish = (height: number) => {
    published = publishHeight(root, height, published);
  };

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => sync()) : null;
  // A panel opening or closing inside a bar turns it static or sticky
  // without a resize the observer would see while the bar is not tracked.
  const barState = new view.MutationObserver(() => sync());
  let watched: HTMLElement[] = [];

  /** Follows attribute changes inside every rendered bar. */
  function watchBars() {
    const bars = Array.from(doc.querySelectorAll<HTMLElement>(BAR_SELECTOR));
    if (sameElements(bars, watched)) return;
    watched = bars;
    barState.disconnect();
    for (const el of bars) barState.observe(el, { subtree: true, attributes: true, attributeFilter: BAR_ATTRIBUTES });
  }

  /**
   * Recheck which bar is sticky, publish its height and, unless the window
   * itself changed size, give back the room a growing bar took.
   */
  function sync(followGrowth = true) {
    watchBars();
    const next = findStickyBar(doc);
    if (next !== bar) {
      if (bar) resize?.unobserve(bar);
      bar = next;
      if (bar) resize?.observe(bar);
      last = bar ? measure(bar) : { top: 0, height: 0 };
      publish(last.height);
      return;
    }
    if (!bar) return;
    const now = measure(bar);
    const scroll = followGrowth ? growthScroll(last, now) : 0;
    publish(now.height);
    if (scroll > 0) view!.scrollBy(0, scroll);
    last = measure(bar);
  }

  /** Scrolling and the banner move the bar without resizing it. */
  const remember = () => {
    if (bar) last = measure(bar);
  };

  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof view.Element) || target.closest(OUTSIDE_PLAY_SELECTOR)) return;
    view.cancelAnimationFrame(focusFrame);
    // After the browser's own focus scroll, so only what it left covered moves.
    focusFrame = view.requestAnimationFrame(() => revealIfCovered(target, bar, doc, view));
  };

  // Bars mounting or unmounting anywhere in the page.
  const structure = new view.MutationObserver((records) => {
    if (mountsOrUnmountsBar(records)) sync();
  });
  structure.observe(doc.body, { childList: true, subtree: true });
  // The consent banner publishes its height on the root style.
  const rootStyle = new view.MutationObserver(remember);
  rootStyle.observe(root, { attributes: true, attributeFilter: ["style"] });
  view.addEventListener("scroll", remember, { passive: true });
  const onResize = () => sync(false);
  view.addEventListener("resize", onResize);
  doc.addEventListener("focusin", onFocus);
  sync();

  return () => {
    structure.disconnect();
    barState.disconnect();
    rootStyle.disconnect();
    resize?.disconnect();
    view.removeEventListener("scroll", remember);
    view.removeEventListener("resize", onResize);
    doc.removeEventListener("focusin", onFocus);
    view.cancelAnimationFrame(focusFrame);
    root.style.removeProperty(GAME_ACTIONS_HEIGHT_VAR);
  };
}
