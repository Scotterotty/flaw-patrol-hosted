"use client";

import Link from "next/link";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { useMenuPlace } from "./menu-place";
import { VersionLine } from "./version-line";
import { GettingStartedItem } from "./first-day";

/** Your name in the top bar: a small menu with your account, appearance, the mini game and Sign out. */
export function AccountMenu({
  children,
  label,
  admin,
  signOut,
  joins,
  waiting = 0,
}: {
  children: ReactNode;
  label: string;
  admin?: boolean;
  signOut: () => Promise<void>;
  joins?: { count: number; href: string } | null;
  /** ver_259: people on no umbrella who pressed Ask to be added (workspace admins only). */
  waiting?: number;
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
  const item = "block w-full rounded px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-100";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-howto="top-account"
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
          {(joins || waiting > 0) && (
            <>
              {waiting > 0 && (
                <Link role="menuitem" href="/workspace#waiting" className={`${item} font-medium text-accent-700`}>
                  <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
                  {waiting === 1 ? "1 person waiting to be added" : `${waiting} people waiting to be added`}
                </Link>
              )}
              {joins && (
                <Link role="menuitem" href={joins.href} className={`${item} font-medium text-accent-700`}>
                  <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
                  {joins.count === 1 ? "1 person asking to join" : `${joins.count} people asking to join`}
                </Link>
              )}
              <div className="my-1 h-px bg-slate-200" />
            </>
          )}
          <Link role="menuitem" href="/account" className={item} data-howto="account-page">
            Your account
          </Link>
          <Link role="menuitem" href="/account#appearance" className={item} data-howto="account-appearance">
            Appearance and accessibility
          </Link>
          {/* ver_216: Start here again, after ✕ Hide for now. */}
          <GettingStartedItem className={item} />
          <Link role="menuitem" href="/whats-new" className={item} data-howto="account-whats-new">
            What&apos;s new
          </Link>
          <Link role="menuitem" href="/account#game" className={item}>
            Mini game and quests
          </Link>
          {admin && (
            <Link role="menuitem" href="/workspace" className={item} data-howto="account-workspace">
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
