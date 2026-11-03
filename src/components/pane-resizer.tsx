"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A line you drag to make a side panel wider or narrower (adjustable windows, ver_156).
 * It changes the panel next to it: the one before it, the one after it, or the one it sits in
 * (then it sits just outside that panel's left or right edge, in the gap, so it never covers a scrollbar). When the panels are laid out in a grid,
 * it sets `--fp-pane` on the grid instead, so the grid's columns use `var(--fp-pane, <normal>)`.
 * Sizes are remembered in this browser per `id`. Double-click or Home puts it back to normal,
 * and Account → Appearance → Reset panel sizes puts them all back.
 * Only shown on wide screens (lg and up, or xl with `from`) and not while Larger text stacks the page.
 */
export function PaneResizer({
  id,
  label,
  min,
  max,
  target = "prev",
  edge = "right",
  from = "lg",
  className = "",
}: {
  id: string;
  /** What the panel is, for screen readers: "the case list". */
  label: string;
  /** Smallest and largest width in px. `max` under 1 means a share of the parent's width (0.6 = 60%). */
  min: number;
  max: number;
  target?: "prev" | "next" | "parent";
  /** With target "parent": which edge of the panel the line sits on. */
  edge?: "left" | "right";
  /** The screen width where the panels sit side by side (and the line shows). */
  from?: "lg" | "xl";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `fp-pane:${id}`;
  // Dragging right makes the panel wider when the line is on its right edge, narrower when on its left.
  const onLeft = target === "next" || (target === "parent" && edge === "left");
  const dir = onLeft ? -1 : 1;

  const pane = useCallback((): HTMLElement | null => {
    const el = ref.current;
    if (!el) return null;
    if (target === "parent") return el.parentElement;
    return (target === "prev" ? el.previousElementSibling : el.nextElementSibling) as HTMLElement | null;
  }, [target]);

  const limit = useCallback(
    (px: number) => {
      const box = pane()?.parentElement?.getBoundingClientRect().width ?? 2000;
      const hi = max < 1 ? box * max : max;
      return Math.round(Math.max(min, Math.min(hi, px)));
    },
    [min, max, pane],
  );

  const apply = useCallback(
    (px: number | null, save: boolean) => {
      const p = pane();
      const el = ref.current;
      const box = p?.parentElement;
      if (!p || !el || !box) return;
      const grid = getComputedStyle(box).display.includes("grid");
      const shown = getComputedStyle(el).display !== "none";
      if (px === null || !shown) {
        box.style.removeProperty("--fp-pane");
        p.style.removeProperty("width");
        p.style.removeProperty("flex");
        el.removeAttribute("aria-valuenow");
      } else {
        const w = limit(px);
        if (grid) box.style.setProperty("--fp-pane", `${w}px`);
        else {
          p.style.width = `${w}px`;
          p.style.flex = "none";
        }
        el.setAttribute("aria-valuenow", String(w));
      }
      if (save) {
        try {
          if (px === null) localStorage.removeItem(key);
          else localStorage.setItem(key, String(limit(px)));
        } catch {}
      }
    },
    [key, limit, pane],
  );

  const saved = useCallback(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  }, [key]);

  // Put back the remembered size, and drop it while the screen is too narrow (panels stack there).
  useEffect(() => {
    const again = () => apply(saved(), false);
    again();
    window.addEventListener("resize", again);
    window.addEventListener("fp-panes-reset", again);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("fp-panes-reset", again);
    };
  }, [apply, saved]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pane();
    if (!p || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = p.getBoundingClientRect().width;
    const before = saved();
    const el = e.currentTarget;
    // Guards against resizing by accident (persona audit, Nov 2):
    // - with a mouse, nothing moves until you've dragged 6px sideways while holding the button, so a click or a slip does nothing,
    //   and moving up or down first (say, grabbing a scrollbar next to the line) doesn't resize at all;
    // - with a finger or pen, you press and hold for 0.4 s first, so scrolling past the line does nothing;
    // - Esc while dragging puts the panel back;
    // - letting go anywhere (or the window losing focus) always ends it.
    const touch = e.pointerType !== "mouse";
    let started = false;
    let held = !touch;
    const timer = touch ? window.setTimeout(() => (held = true), 400) : 0;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    const begin = () => {
      started = true;
      el.dataset.dragging = "";
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const move = (ev: PointerEvent) => {
      if (ev.buttons === 0) return up();
      const dx = ev.clientX - startX;
      if (!started) {
        const dy = Math.abs(ev.clientY - startY);
        if (dy >= 6 && dy > Math.abs(dx)) return up(); // mostly up or down: a scroll, not a resize
        if (Math.abs(dx) < 6) return;
        if (!held) return up(); // a finger moved before the hold finished: it was a scroll
        begin();
      }
      apply(startW + dir * dx, true);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return;
      ev.preventDefault();
      ev.stopPropagation();
      apply(before, false);
      try {
        if (before === null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(before));
      } catch {}
      up();
    };
    function up() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      window.removeEventListener("keydown", esc, true);
      el.removeEventListener("lostpointercapture", up);
      delete el.dataset.dragging;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    window.addEventListener("keydown", esc, true);
    el.addEventListener("lostpointercapture", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const p = pane();
    if (!p) return;
    const w = p.getBoundingClientRect().width;
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowRight") apply(w + step * dir, true);
    else if (e.key === "ArrowLeft") apply(w - step * dir, true);
    else if (e.key === "Home") apply(null, true);
    else return;
    e.preventDefault();
  };

  const place = target === "parent" ? `absolute inset-y-0 ${edge === "left" ? "-left-3" : "-right-3"}` : "relative self-stretch";
  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Resize ${label}. Arrow keys resize, Home puts it back.`}
      aria-valuemin={min}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onDoubleClick={() => apply(null, true)}
      onKeyDown={onKeyDown}
      className={`group z-10 hidden w-3 shrink-0 cursor-col-resize touch-none ${from === "xl" ? "xl:block" : "lg:block"} ${place} bigtext:hidden focus-visible:outline-none ${className}`}
    >
      {/* A thin line you can always see (ver_160), brighter on hover or drag. */}
      <span
        aria-hidden
        className="absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded bg-slate-200 transition-colors group-hover:bg-accent-400 group-hover:delay-150 group-focus-visible:bg-accent-500 group-data-dragging:bg-accent-500"
      />
      {/* The grip sits in the middle of the panel, or mid-screen when the panel is taller than the screen (ver_160). */}
      <span aria-hidden className="pointer-events-none sticky top-0 flex h-full max-h-screen items-center justify-center">
        <span
          data-testid="pane-grip"
          className="relative grid h-11 w-3 content-center justify-items-center gap-1 rounded-full bg-slate-400 transition-colors group-hover:bg-accent-500 group-focus-visible:bg-accent-500 group-data-dragging:bg-accent-500"
        >
          <i className="size-1 rounded-full bg-surface" />
          <i className="size-1 rounded-full bg-surface" />
          <i className="size-1 rounded-full bg-surface" />
          {/* Only while dragging: how to undo it (Scott picked this one hint, Nov 2). */}
          <span
            data-testid="pane-drag-hint"
            className={`pointer-events-none absolute top-1/2 hidden -translate-y-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-white shadow group-data-dragging:block ${onLeft ? "right-full mr-2" : "left-full ml-2"}`}
          >
            Double-click to reset · Esc to cancel
          </span>
        </span>
      </span>
    </div>
  );
}

/** Puts every panel back to its normal size (Account → Appearance). */
export function resetAllPanes() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("fp-pane:")) localStorage.removeItem(k);
  } catch {}
  window.dispatchEvent(new Event("fp-panes-reset"));
}
