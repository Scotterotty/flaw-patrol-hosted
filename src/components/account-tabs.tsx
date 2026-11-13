"use client";

import { pageScroller } from "@/lib/page-scroll";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/**
 * The floating pill of section tabs on Your account. The tab for the section you're reading
 * lights up as you scroll, in order, even for the last few sections that can't reach the top.
 * A tab you click stays lit until you scroll yourself.
 */
export function AccountTabs({ tabs, label = "Account sections" }: { tabs: [id: string, label: string][]; label?: string }) {
  const nav = useRef<HTMLElement>(null);
  const pinned = useRef<string | null>(null);
  const [current, setCurrent] = useState(tabs[0][0]);

  useEffect(() => {
    const update = () => {
      const bar = nav.current;
      if (!bar) return;
      const sections = tabs.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
      if (!sections.length) return;
      let cur = sections[0].id;
      if (pinned.current) cur = pinned.current;
      else {
        // The reading line sits just under the bar, then slides down the window over the last
        // stretch of scrolling, so the bottom sections still each get their turn.
        const barBottom = bar.getBoundingClientRect().bottom;
        const view = window.innerHeight;
        const doc = pageScroller();
        const remaining = doc.scrollHeight - view - doc.scrollTop;
        const stretch = Math.min(view * 0.8, doc.scrollHeight - view);
        const t = stretch > 0 ? Math.min(1, Math.max(0, 1 - remaining / stretch)) : 1;
        const line = barBottom + 30 + t * (view - barBottom - 70);
        for (const s of sections) if (s.getBoundingClientRect().top <= line) cur = s.id;
      }
      setCurrent(cur);
      // Keep the lit tab in sight when the pill has to swipe sideways on a narrow screen.
      const on = bar.querySelector<HTMLElement>(`[data-tab="${cur}"]`);
      if (on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - 40;
    };
    const unpin = (e: Event) => {
      if (pinned.current && !nav.current?.contains(e.target as Node)) {
        pinned.current = null;
        update();
      }
    };
    const fromHash = tabs.find(([id]) => `#${id}` === window.location.hash);
    if (fromHash) pinned.current = fromHash[0];
    update();
    // Capture: the page may scroll in <body> (How-to guide open), whose scroll doesn't reach window.
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    for (const ev of events) window.addEventListener(ev, unpin, { passive: true });
    return () => {
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
      for (const ev of events) window.removeEventListener(ev, unpin);
    };
  }, [tabs]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    const bar = nav.current;
    if (!el || !bar) return;
    pinned.current = id;
    setCurrent(id);
    history.replaceState(null, "", `#${id}`);
    const smooth = !document.documentElement.dataset.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const page = pageScroller();
    page.scrollTo({ top: el.getBoundingClientRect().top + page.scrollTop - bar.getBoundingClientRect().bottom - 12, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <nav
      ref={nav}
      aria-label={label}
      className="sticky top-14 z-10 ml-[50%] mb-5 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 md:max-w-[calc(100vw-14rem)] gap-0.5 overflow-x-auto rounded-full bg-surface p-1 text-sm shadow-[0_6px_18px_-6px_rgb(0_0_0/0.25)] ring-1 ring-slate-200 [scrollbar-width:none]"
    >
      {tabs.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          data-tab={id}
          aria-current={current === id ? "location" : undefined}
          onClick={(e) => {
            e.preventDefault();
            go(id);
          }}
          className={cx(
            "rounded-full px-3 py-1 whitespace-nowrap transition-colors",
            current === id ? "bg-accent-600 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
