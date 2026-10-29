"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Rendered at the end of the page so a dialog opened from a menu stays visible when the menu closes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-full rounded-lg bg-surface p-0 shadow-xl backdrop:bg-black/50 ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {open && (
        <div className="relative p-5">
          <h2 className="mb-4 pr-8 text-base font-semibold text-slate-900">{title}</h2>
          {children}
          {/* Every popup box has an ✕ (ver_89); Esc and clicking outside still close it too. It comes
              last so opening the box still puts the cursor in its first field. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="absolute top-4 right-4 rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            ✕
          </button>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
