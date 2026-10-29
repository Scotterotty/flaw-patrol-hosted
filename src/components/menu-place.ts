"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Keeps a dropdown on the screen: it opens downward when there's room, flips up
 * when there's more room above, and scrolls inside when it fits neither way.
 */
export function useMenuPlace(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, gap = 4): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) return setStyle({});
    const place = () => {
      if (!anchor.current || !menu.current) return;
      const a = anchor.current.getBoundingClientRect();
      const margin = 8;
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
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, menu, gap]);
  return style;
}
