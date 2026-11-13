/**
 * The element the page scrolls in. Usually the window (the root element), but while the How-to
 * guide is open on a computer the page scrolls in <body>, so its scroll bar sits at the page's
 * own edge, left of the guide, instead of right beside the guide's bar (Scott, Nov 13 2026).
 */
export function pageScroller(): HTMLElement {
  const body = document.body;
  if (body && /auto|scroll/.test(getComputedStyle(body).overflowY)) return body;
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** How far the page is scrolled down, wherever it scrolls. */
export const pageScrollTop = () => pageScroller().scrollTop;
