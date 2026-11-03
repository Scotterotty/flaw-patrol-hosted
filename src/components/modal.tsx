"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  locked,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  /** While something is being saved and opened: Esc, clicking outside and ✕ don't close it. */
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Rendered at the end of the page so a dialog opened from a menu stays visible when the menu closes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Wide boxes (bug reports, templates, uploads...) get ⤢ to fill most of the screen. Remembered per kind of box.
  const bigKey = `fp-modal-big:${title.split(/ · |: /)[0]}`;
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!wide || !open) return;
    try {
      setBig(localStorage.getItem(bigKey) === "1");
    } catch {}
  }, [wide, open, bigKey]);
  const toggleBig = () => {
    setBig((b) => {
      try {
        if (b) localStorage.removeItem(bigKey);
        else localStorage.setItem(bigKey, "1");
      } catch {}
      return !b;
    });
  };
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
      onClick={(e) => !locked && e.target === ref.current && onClose()}
      className={`m-auto w-full rounded-lg bg-surface p-0 shadow-xl backdrop:bg-black/50 ${wide && big ? "max-h-[94vh] max-w-[min(94vw,110rem)] [&_textarea]:min-h-[min(45vh,28rem)]" : wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {open && (
        <div className="relative p-5">
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
