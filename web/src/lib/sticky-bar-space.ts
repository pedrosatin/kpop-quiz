/**
 * Room for the sticky .game-actions bar.
 *
 * Below 60rem the bar is sticky at the foot of the screen, above the consent
 * banner, and covers the end of the card while the card is taller than the
 * screen. The bar's height changes with its message, so no fixed budget fits
 * every state. This module measures the bar while it is sticky and:
 *
 * - publishes its height as --game-actions-height on the root, which the
 *   root scroll padding adds to the consent banner, so focus, scrollIntoView
 *   and in-page jumps stop above the bar;
 * - when the stuck bar grows (a message of several lines), scrolls the page
 *   by what the bar took, so whatever was above the bar stays above it;
 * - scrolls a focused element that sits behind the bar or the banner into
 *   view, also after a tap, which does not scroll by itself.
 *
 * A bar that is not sticky (side panel from 60rem, an open source panel)
 * publishes nothing and is left alone.
 */

export const GAME_ACTIONS_HEIGHT_VAR = "--game-actions-height";

const BAR_SELECTOR = ".game-actions";
/** Focus inside these never needs room above the bar. */
const OUTSIDE_PLAY_SELECTOR = ".game-actions, .consent-banner, dialog";
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
    const value = height > 0 ? `${Math.ceil(height)}px` : "";
    if (value === published) return;
    published = value;
    if (value) root.style.setProperty(GAME_ACTIONS_HEIGHT_VAR, value);
    else root.style.removeProperty(GAME_ACTIONS_HEIGHT_VAR);
  };

  const measure = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  };

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => sync()) : null;

  /**
   * Recheck which bar is sticky, publish its height and, unless the window
   * itself changed size, give back the room a growing bar took.
   */
  function sync(followGrowth = true) {
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
    focusFrame = view.requestAnimationFrame(() => {
      if (!bar || doc.activeElement !== target || target.contains(bar)) return;
      const edge = Math.min(bar.getBoundingClientRect().top, bannerTop(doc, view));
      if (coveredAtBottom(target.getBoundingClientRect(), edge)) target.scrollIntoView({ block: "nearest" });
    });
  };

  // A bar mounts, unmounts or turns sticky again (a source panel closes)
  // without resizing while it is not observed.
  const mutations = new view.MutationObserver((records) => {
    if (records.some((record) => record.target !== root)) sync();
    else remember();
  });
  mutations.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "open"] });
  // The consent banner publishes its height on the root style.
  mutations.observe(root, { attributes: true, attributeFilter: ["style"] });
  view.addEventListener("scroll", remember, { passive: true });
  const onResize = () => sync(false);
  view.addEventListener("resize", onResize);
  doc.addEventListener("focusin", onFocus);
  sync();

  return () => {
    mutations.disconnect();
    resize?.disconnect();
    view.removeEventListener("scroll", remember);
    view.removeEventListener("resize", onResize);
    doc.removeEventListener("focusin", onFocus);
    view.cancelAnimationFrame(focusFrame);
    root.style.removeProperty(GAME_ACTIONS_HEIGHT_VAR);
  };
}
