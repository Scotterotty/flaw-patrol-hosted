"use client";

import { useEffect, useRef, useState } from "react";
import { useMenuPlace } from "./menu-place";
import { Button, cx } from "./ui";

/** A "More" button that holds the less common actions, so the main ones stand out. */
export function MoreMenu({
  children,
  label = "More",
  title,
  ariaLabel,
  caret = true,
  size,
  howto,
}: {
  children: React.ReactNode;
  label?: string;
  title?: string;
  /** A spoken name when the label is only a symbol, like "⋯". */
  ariaLabel?: string;
  caret?: boolean;
  size?: "sm" | "md";
  /** The How-to guide's Show me name for the More button. */
  howto?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const place = useMenuPlace(open, box, list);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Button aria-expanded={open} aria-haspopup="menu" aria-label={ariaLabel} title={title} size={size} onClick={() => setOpen((o) => !o)} data-howto={howto}>
        {label}
        {caret && (
          <>
            {" "}
            <span aria-hidden className="ml-1 text-xs">▾</span>
          </>
        )}
      </Button>
      <div
        ref={list}
        role="menu"
        onClick={() => setOpen(false)}
        style={place}
        className={cx(
          "absolute top-full right-0 z-30 min-w-44 rounded-lg border border-slate-200 bg-surface p-1 shadow-lg",
          "[&_a]:w-full [&_a]:justify-start [&_a]:font-normal [&_button]:w-full [&_button]:justify-start [&_button]:font-normal",
          !open && "hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
