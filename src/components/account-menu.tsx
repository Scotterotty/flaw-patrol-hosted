"use client";

import Link from "next/link";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { useMenuPlace } from "./menu-place";
import { VersionLine } from "./version-line";

/** Your name in the top bar: a small menu with your account, appearance, the mini game and Sign out. */
export function AccountMenu({ children, label, admin, signOut, joins }: { children: ReactNode; label: string; admin?: boolean; signOut: () => Promise<void>; joins?: { count: number; href: string } | null }) {
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
  const item = "block w-full rounded px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-100";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-80 items-center gap-2 rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        {children}
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div ref={list} role="menu" style={place} onClick={() => setOpen(false)} className="absolute top-full right-0 z-40 w-52 rounded-lg border border-slate-200 bg-surface p-1 shadow-lg">
          {/* Ask to join: the dot on the avatar leads here. */}
          {joins && (
            <>
              <Link role="menuitem" href={joins.href} className={`${item} font-medium text-accent-700`}>
                <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
                {joins.count === 1 ? "1 person asking to join" : `${joins.count} people asking to join`}
              </Link>
              <div className="my-1 h-px bg-slate-200" />
            </>
          )}
          <Link role="menuitem" href="/account" className={item}>
            Your account
          </Link>
          <Link role="menuitem" href="/account#appearance" className={item}>
            Appearance
          </Link>
          <Link role="menuitem" href="/whats-new" className={item}>
            What&apos;s new
          </Link>
          <Link role="menuitem" href="/account#game" className={item}>
            Mini game and quests
          </Link>
          {admin && (
            <Link role="menuitem" href="/workspace" className={item}>
              Workspace settings
            </Link>
          )}
          <div className="my-1 h-px bg-slate-200" />
          {/* Keep the menu open while signing out: closing it would remove the form before it submits. */}
          <form action={signOut} onClick={(e) => e.stopPropagation()}>
            <button role="menuitem" className={item}>
              Sign out
            </button>
          </form>
          <div className="my-1 h-px bg-slate-200" />
          <VersionLine className="px-3 py-1 text-xs" />
        </div>
      )}
    </div>
  );
}
