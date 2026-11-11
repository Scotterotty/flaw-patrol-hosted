"use client";

import { useRef } from "react";

const MIN = 480;
const keyOf = (kind: string) => `fp-pane:box-${kind}`;
export const boxKey = keyOf;

/** The width this person dragged this kind of box to, or null for its normal width. */
export function savedBoxWidth(kind: string): number | null {
  try {
    const v = Number(localStorage.getItem(keyOf(kind)));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function save(kind: string, w: number | null) {
  try {
    if (w === null) localStorage.removeItem(keyOf(kind));
    else localStorage.setItem(keyOf(kind), String(w));
  } catch {}
}

/**
 * The grip on a big popup's left or right edge (roomier bug form, Nov 10): drag it to make the box
 * wider or narrower. The box stays centered, so it grows on both sides. Same guards as side panels
 * (ver_156): nothing moves until you've dragged 6px sideways, a finger holds 0.4 s first, Esc puts it
 * back, double-click or Home goes back to normal. Saved in this browser with the side panels, so
 * Account → Appearance → Reset panel sizes resets boxes too. Only on wide screens, not in Larger text.
 */
export function BoxEdge({ side, kind, onWidth }: { side: "left" | "right"; kind: string; onWidth: (w: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dir = side === "right" ? 1 : -1;
  const box = () => ref.current?.closest("dialog") as HTMLElement | null;
  const limit = (px: number) => Math.round(Math.max(MIN, Math.min(window.innerWidth - 32, px)));
  const set = (w: number | null, keep = true) => {
    const v = w === null ? null : limit(w);
    if (keep) save(kind, v);
    onWidth(v);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = box();
    if (!d || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = d.getBoundingClientRect().width;
    const before = savedBoxWidth(kind);
    const el = e.currentTarget;
    const touch = e.pointerType !== "mouse";
    let started = false;
    let held = !touch;
    const timer = touch ? window.setTimeout(() => (held = true), 400) : 0;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    const move = (ev: PointerEvent) => {
      if (ev.buttons === 0) return up();
      const dx = ev.clientX - startX;
      if (!started) {
        const dy = Math.abs(ev.clientY - startY);
        if (dy >= 6 && dy > Math.abs(dx)) return up();
        if (Math.abs(dx) < 6) return;
        if (!held) return up();
        started = true;
        el.dataset.dragging = "";
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
      // Centered: each pixel the edge moves out widens the box by two.
      set(startW + 2 * dir * dx);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return;
      // Esc while dragging cancels the drag only; it doesn't close the box.
      ev.preventDefault();
      ev.stopPropagation();
      save(kind, before);
      onWidth(before);
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
    const d = box();
    if (!d) return;
    const w = d.getBoundingClientRect().width;
    const step = e.shiftKey ? 128 : 32;
    if (e.key === "ArrowRight") set(w + step * dir);
    else if (e.key === "ArrowLeft") set(w - step * dir);
    else if (e.key === "Home") set(null);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      // No box title or the word "key" here: specs find fields by label text (getByLabel("Key") matched "Arrow keys").
      aria-label={`Resize this box (${side} edge). Arrows resize, Home resets.`}
      aria-valuemin={MIN}
      aria-valuenow={Math.round(box()?.getBoundingClientRect().width ?? MIN)}
      title="Drag to resize"
      data-testid={`box-edge-${side}`}
      data-howto={side === "right" ? "box-edge" : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={() => set(null)}
      onKeyDown={onKeyDown}
      className={`group absolute inset-y-0 z-10 hidden w-4 cursor-col-resize touch-none lg:block bigtext:hidden focus-visible:outline-none ${side === "left" ? "-left-2" : "-right-2"}`}
    >
      <span aria-hidden className="pointer-events-none sticky top-0 flex h-full max-h-screen items-center justify-center">
        <span className="relative grid h-14 w-2.5 content-center justify-items-center gap-1 rounded-full bg-accent-500 shadow ring-2 ring-surface transition-colors group-hover:bg-accent-600 group-focus-visible:bg-accent-700 group-data-dragging:bg-accent-700">
          <i className="size-1 rounded-full bg-surface" />
          <i className="size-1 rounded-full bg-surface" />
          <i className="size-1 rounded-full bg-surface" />
          <span
            data-testid="box-drag-hint"
            className={`pointer-events-none absolute top-1/2 hidden -translate-y-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-white shadow group-data-dragging:block ${side === "left" ? "left-full ml-2" : "right-full mr-2"}`}
          >
            Double-click to reset · Esc to cancel
          </span>
        </span>
      </span>
    </div>
  );
}
