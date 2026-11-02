"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * A row of tabs that scrolls sideways on narrow screens. While more tabs are
 * off the right edge, that edge fades and shows › so people know to swipe
 * (ver_54 audit #14).
 */
export function ScrollTabs({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
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
  return (
    <div className="relative">
      <nav
        ref={ref}
        aria-label={label}
        className={cx(className, more && "[mask-image:linear-gradient(to_left,transparent,black_3.5rem)]")}
      >
        {children}
      </nav>
      {more && (
        <span aria-hidden data-testid="more-tabs" className="pointer-events-none absolute top-0 right-0 flex h-full items-center pr-1 text-base font-bold text-accent-700">
          ›
        </span>
      )}
    </div>
  );
}
