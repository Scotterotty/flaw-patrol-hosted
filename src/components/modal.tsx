"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BoxEdge, savedBoxWidth } from "./box-edge";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  roomy,
  locked,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  /** Bug forms: opens wider than other wide boxes, since they hold a lot (roomier bug form, Nov 10). */
  roomy?: boolean;
  /** While something is being saved and opened: Esc, clicking outside and ✕ don't close it. */
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Rendered at the end of the page so a dialog opened from a menu stays visible when the menu closes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Wide boxes (bug reports, templates, uploads...) get ⤢ to fill most of the screen. Remembered per kind of box.
  const kind = title.split(/ · |: /)[0];
  const bigKey = `fp-modal-big:${kind}`;
  const [big, setBig] = useState(false);
  // Wide boxes can also be dragged wider or narrower by their left or right edge (roomier bug form, Nov 10).
  // The width you drag to is remembered per kind of box, like side panels; ⤢ still fills the screen in one click.
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!wide || !open) return;
    try {
      setBig(localStorage.getItem(bigKey) === "1");
    } catch {}
    setWidth(savedBoxWidth(kind));
  }, [wide, open, bigKey, kind]);
  useEffect(() => {
    if (!wide) return;
    const again = () => setWidth(savedBoxWidth(kind));
    window.addEventListener("fp-panes-reset", again);
    return () => window.removeEventListener("fp-panes-reset", again);
  }, [wide, kind]);
  const setBigTo = (b: boolean) => {
    try {
      if (!b) localStorage.removeItem(bigKey);
      else localStorage.setItem(bigKey, "1");
    } catch {}
    setBig(b);
  };
  const toggleBig = () => setBigTo(!big);
  // A click outside closes the box only when the press started outside too: dragging to select
  // text in a field and letting go past the box's edge used to close it and lose what you typed.
  // Once you've typed in the box, a click outside doesn't close it at all; ✕ and Esc still do.
  const pressedOutside = useRef(false);
  const typed = useRef(false);
  useEffect(() => {
    if (open) typed.current = false;
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, mounted]);

  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => locked && e.preventDefault()}
      onPointerDown={(e) => (pressedOutside.current = e.target === ref.current)}
      onInput={() => (typed.current = true)}
      onClick={(e) => {
        const outside = e.target === ref.current && pressedOutside.current;
        pressedOutside.current = false;
        if (!locked && outside && !typed.current) onClose();
      }}
      data-sized={wide && width && !big ? "" : undefined}
      style={wide && width && !big ? { maxWidth: `min(${width}px, calc(100vw - 2rem))` } : undefined}
      className={`m-auto w-full rounded-lg bg-surface p-0 shadow-xl backdrop:bg-black/50 ${wide ? "overflow-visible" : ""} ${wide && big ? "max-h-[94vh] max-w-[min(94vw,110rem)] [&_textarea]:min-h-[min(45vh,28rem)]" : wide && roomy ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {open && wide && (
        <>
          <BoxEdge side="left" kind={kind} onWidth={(w) => (setWidth(w), w !== null && big && setBigTo(false))} />
          <BoxEdge side="right" kind={kind} onWidth={(w) => (setWidth(w), w !== null && big && setBigTo(false))} />
        </>
      )}
      {open && (
        <div className={`relative p-5 ${wide ? `${big ? "max-h-[94vh]" : "max-h-[calc(100dvh-2rem-6px)]"} overflow-y-auto rounded-lg` : ""}`} data-box-scroll={wide ? "" : undefined}>
          <h2 className={`mb-4 ${wide ? "pr-16" : "pr-8"} text-base font-semibold text-slate-900`}>{title}</h2>
          {children}
          {/* Every popup box has an ✕; Esc and clicking outside still close it too. It comes
              last so opening the box still puts the cursor in its first field. */}
          {wide && (
            <button
              type="button"
              onClick={toggleBig}
              aria-pressed={big}
              aria-label={big ? "Shrink this box" : "Expand this box"}
              title={big ? "Smaller" : "Bigger"}
              className="absolute top-4 right-12 rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              {big ? "⤡" : "⤢"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label="Close"
            title="Close (Esc)"
            className="absolute top-4 right-4 rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-accent-500 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ✕
          </button>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
