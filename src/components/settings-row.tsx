"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "./ui";

type Rows = { open: string | null; setOpen: (id: string | null) => void };
const RowsContext = createContext<Rows | null>(null);
const RowContext = createContext<() => void>(() => {});

/**
 * Holds the umbrella's "Set once" rows so only one is open at a time:
 * opening a row closes the one that was open.
 */
export function SettingsRows({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return <RowsContext.Provider value={{ open, setOpen }}>{children}</RowsContext.Provider>;
}

/** Closes the row a form sits in, for its Cancel button. */
export const useCloseRow = () => useContext(RowContext);

/**
 * A row in the umbrella's "Set once" list that opens its settings right below it.
 * It also opens when the address ends in one of its hashes (#members, #jira…),
 * so links from search, the hub checklist and old bookmarks land on the open form.
 * `openHash` is put in the address when the button opens it (Import… uses #import-template).
 */
export function ExpandRow({
  id,
  hashes,
  title,
  text,
  label,
  status,
  openHash,
  buttonVariant,
  buttonTitle,
  howto,
  children,
}: {
  id: string;
  hashes: string[];
  title: string;
  text: string;
  label: string;
  status?: ReactNode;
  openHash?: string;
  buttonVariant?: "primary";
  buttonTitle?: string;
  /** data-howto on the row's button, for the How-to guide's Show me. */
  howto?: string;
  children: ReactNode;
}) {
  const rows = useContext(RowsContext);
  const [alone, setAlone] = useState(false);
  const open = rows ? rows.open === id : alone;
  const setOpen = (on: boolean) => (rows ? rows.setOpen(on ? id : null) : setAlone(on));
  useEffect(() => {
    const check = () => {
      const h = window.location.hash.slice(1);
      if (!hashes.includes(h)) return;
      setOpen(true);
      // Scroll once the opened form is on the page.
      requestAnimationFrame(() => (document.getElementById(h) ?? document.getElementById(`row-${id}`))?.scrollIntoView({ block: "start" }));
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashes.join(" ")]);
  const toggle = () => {
    const next = !open;
    // Keep the address in step with the open row, without jumping the page.
    const url = window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, "", next ? `${url}#${openHash ?? hashes[0]}` : url);
    setOpen(next);
    if (next) requestAnimationFrame(() => document.getElementById(`row-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  return (
    <li id={`row-${id}`} className="scroll-mt-20">
      <div className={`flex items-center gap-3 px-4 py-3 ${open ? "bg-accent-50" : ""}`}>
        <span className="min-w-0 flex-1">
          <button type="button" onClick={toggle} aria-expanded={open} className={`flex items-center gap-1.5 text-left font-medium hover:underline ${open ? "text-accent-700" : "text-slate-900"}`}>
            {title}
            <svg aria-hidden viewBox="0 0 10 6" className={`size-2.5 flex-none transition-transform motion-reduce:transition-none ${open ? "rotate-180 text-accent-700" : "text-slate-400"}`}>
              <path d="M0 0h10L5 6z" fill="currentColor" />
            </svg>
          </button>
          <span className="block text-sm text-slate-500">{text}</span>
        </span>
        {status}
        <Button size="sm" variant={open ? undefined : buttonVariant} aria-expanded={open} title={open ? undefined : buttonTitle} onClick={toggle} data-howto={open ? undefined : howto}>
          {open ? "Hide" : label}
        </Button>
      </div>
      {open && (
        <div className="bg-accent-50 px-4 pt-1 pb-4">
          <RowContext.Provider value={() => setOpen(false)}>{children}</RowContext.Provider>
        </div>
      )}
    </li>
  );
}

/** Sends an old address on to its new home, keeping the #part so the right form opens. */
export function HashRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to + window.location.hash);
  }, [to]);
  return null;
}

/**
 * Rows someone can only look at, folded under one line (Monday audit: Members saw a long list
 * of settings they couldn't change). Opens by itself when the address names one of its rows.
 */
export function FoldedRows({ title, sub, hashes, children }: { title: string; sub: string; hashes: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => hashes.includes(window.location.hash.slice(1)) && setOpen(true);
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashes.join(" ")]);
  return (
    <li data-testid="team-setup">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" data-howto="settings-team-setup">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-medium text-slate-900">
            {title}
            <svg aria-hidden viewBox="0 0 10 6" className={`size-2.5 flex-none transition-transform motion-reduce:transition-none ${open ? "rotate-180 text-accent-700" : "text-slate-400"}`}>
              <path d="M0 0h10L5 6z" fill="currentColor" />
            </svg>
          </span>
          <span className="block text-sm text-slate-500">{sub}</span>
        </span>
        <span className="text-sm text-accent-700">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/50">{children}</ul>}
    </li>
  );
}
