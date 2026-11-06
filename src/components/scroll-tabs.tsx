"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * A row of tabs that scrolls sideways on narrow screens. While more tabs are
 * off the right edge, that edge fades and shows › so people know to swipe
 * (ver_54 audit #14). Click › to slide the row along.
 *
 * The row never shows a scrollbar (ver_186): Windows drew an up/down bar at the
 * right end of every tab row. Its line along the bottom is drawn inside the row,
 * so tabs don't need to hang below it, and the row only scrolls sideways.
 * Swipe, Shift + scroll, Tab key or › all still reach every tab.
 */
export function ScrollTabs({
  className,
  label,
  tablist,
  children,
}: {
  className?: string;
  label?: string;
  /** Render as role="tablist" (buttons that switch in place) instead of a nav of links. */
  tablist?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement & HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);
  const rowClass = cx(
    className,
    "overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
    more && "[mask-image:linear-gradient(to_left,transparent,black_3.5rem)]",
  );
  const slide = () => {
    const el = ref.current;
    if (!el) return;
    const smooth = !document.documentElement.dataset.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: Math.max(80, el.clientWidth * 0.7), behavior: smooth ? "smooth" : "auto" });
  };
  return (
    <div className="relative">
      {tablist ? (
        <div ref={ref} role="tablist" aria-label={label} className={rowClass}>
          {children}
        </div>
      ) : (
        <nav ref={ref} aria-label={label} className={rowClass}>
          {children}
        </nav>
      )}
      {more && (
        // A mouse helper only: keyboard users reach hidden tabs with Tab, which scrolls them into view.
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-testid="more-tabs"
          title="More tabs"
          onClick={slide}
          className="absolute top-0 right-0 flex h-full cursor-pointer items-center pr-1 pl-3 text-base font-bold text-accent-700 hover:text-accent-900"
        >
          ›
        </button>
      )}
    </div>
  );
}

