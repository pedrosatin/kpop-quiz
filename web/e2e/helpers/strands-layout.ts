/**
 * Layout metrics for the Strands board and sticky action bar.
 * Kept as a plain function so Playwright page.evaluate can serialize it.
 */
export function measureStrandsLayout() {
  const actionsEl = document.querySelector(".word-search-actions, .game-actions") as HTMLElement | null;
  const messageEl = document.querySelector(
    ".word-search-actions .word-search-message:not(.visually-hidden), .game-actions .game-actions-message:not(.visually-hidden)",
  ) as HTMLElement | null;
  const rows = [...document.querySelectorAll(".word-search-row")];
  const firstRow = rows[0]?.getBoundingClientRect();
  const lastRow = rows[rows.length - 1]?.getBoundingClientRect();
  const actions = actionsEl?.getBoundingClientRect();
  const consent = document.querySelector(".consent-banner")?.getBoundingClientRect();
  const coverTop = Math.min(actions?.top ?? Infinity, consent?.top ?? Infinity, window.innerHeight);
  const buttonEls = [
    ...document.querySelectorAll<HTMLElement>(".word-search-actions > .btn, .word-search-actions .strands-bar-actions > .btn, .game-actions > .btn"),
  ];
  const buttonRects = buttonEls.map((btn) => {
    const rect = btn.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      width: rect.width,
      textClipped: btn.scrollWidth > btn.clientWidth + 1,
      label: (btn.textContent || "").trim(),
    };
  });
  let buttonsOverlap = false;
  for (let i = 0; i < buttonRects.length; i++) {
    for (let j = i + 1; j < buttonRects.length; j++) {
      const a = buttonRects[i]!;
      const b = buttonRects[j]!;
      if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) {
        buttonsOverlap = true;
      }
    }
  }
  const cell = document.querySelector(".word-search-cell")?.getBoundingClientRect();
  const kicker = document.querySelector(".kicker")?.getBoundingClientRect();
  const theme = document.querySelector("[data-testid='strands-theme']")?.getBoundingClientRect();
  let messageLines = 0;
  if (messageEl) {
    const style = getComputedStyle(messageEl);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    messageLines = lineHeight > 0 ? Math.round(messageEl.getBoundingClientRect().height / lineHeight) : 0;
  }
  const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return {
    firstRowTop: firstRow?.top ?? null,
    firstRowBottom: firstRow?.bottom ?? null,
    lastRowBottom: lastRow?.bottom ?? null,
    actionsTop: actions?.top ?? null,
    coverTop: Number.isFinite(coverTop) ? coverTop : null,
    maxButtonRight: buttonRects.length ? Math.max(...buttonRects.map((b) => b.right)) : null,
    minButtonHeight: buttonRects.length ? Math.min(...buttonRects.map((b) => b.height)) : null,
    buttonsOverlap,
    anyButtonTextClipped: buttonRects.some((b) => b.textClipped),
    buttonLabels: buttonRects.map((b) => b.label),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    messageLines,
    cellSize: cell ? Math.min(cell.width, cell.height) : null,
    cellMinPx: rootFont * 1.625,
    kickerLeft: kicker?.left ?? null,
    themeTop: theme?.top ?? null,
    themeBottom: theme?.bottom ?? null,
  };
}

export type StrandsLayoutMetrics = ReturnType<typeof measureStrandsLayout>;
