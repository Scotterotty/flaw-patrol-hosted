"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Keeps a dropdown on the screen: it opens downward when there's room, flips up
 * when there's more room above, and scrolls inside when it fits neither way. It also stays inside
 * the screen sideways: a menu that would open past the left or right edge (a right-anchored menu
 * on a phone) slides back in (ver_203).
 */
export function useMenuPlace(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, gap = 4): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) return setStyle({});
    const place = () => {
      if (!anchor.current || !menu.current) return;
      const margin = 8;
      sideways(menu.current, margin);
      const a = anchor.current.getBoundingClientRect();
      const below = window.innerHeight - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      const tall = menu.current.scrollHeight;
      const up = tall > below && above > below;
      const room = up ? above : below;
      setStyle({
        ...(up ? { top: "auto", bottom: `calc(100% + ${gap}px)` } : { top: `calc(100% + ${gap}px)`, bottom: "auto" }),
        ...(tall > room ? { maxHeight: Math.max(120, room), overflowY: "auto" } : {}),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const el = menu.current;
    return () => {
      clearSideways(el);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, menu, gap]);
  return style;
}

/** Undo sideways(): the menu goes back to where its own classes put it. */
function clearSideways(el: HTMLElement) {
  el.style.left = "";
  el.style.right = "";
  el.style.width = "";
  el.style.maxWidth = "";
}

/**
 * Slide a menu sideways so it sits at least `margin` px inside the screen. Done straight on the
 * element (not through React state) so it can be measured where its classes put it each time.
 */
function sideways(el: HTMLElement, margin: number) {
  clearSideways(el);
  const room = window.innerWidth - margin * 2;
  if (el.offsetWidth > room) el.style.maxWidth = `${room}px`;
  const m = el.getBoundingClientRect();
  const left = Math.min(Math.max(m.left, margin), window.innerWidth - margin - m.width);
  if (Math.abs(left - m.left) < 0.5) return;
  const parent = (el.offsetParent ?? document.body).getBoundingClientRect();
  el.style.width = `${Math.min(m.width, room)}px`;
  el.style.left = `${left - parent.left}px`;
  el.style.right = "auto";
}
