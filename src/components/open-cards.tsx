"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setOpenCards } from "@/server/account";
import { FoldCard } from "./fold-card";

type Ctx = { isOpen: (id: string) => boolean; toggle: (id: string) => void; setMany: (ids: string[], on: boolean) => void };
const OpenCards = createContext<Ctx | null>(null);

/**
 * Which folding cards and sections this person keeps open, saved on their account
 * so it's the same on every computer. Used by the Account page and the Mini game sections.
 */
export function OpenCardsProvider({ initial, children }: { initial: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(() => new Set(initial));
  // The latest set, so quick clicks build on each other without reading it inside setOpen.
  const current = useRef(open);
  // Saved straight away: with a short wait, leaving the page right after a click lost it.
  // Next runs server actions one at a time, so quick clicks still save in order.
  // The save happens here, outside setOpen: React can run a setOpen updater while it renders,
  // and starting a server action there updates the Router mid-render (a console error Scott saw on Your account).
  const change = useCallback((edit: (n: Set<string>) => void) => {
    const n = new Set(current.current);
    edit(n);
    current.current = n;
    setOpen(n);
    void setOpenCards([...n]);
  }, []);
  const value = useMemo<Ctx>(
    () => ({
      isOpen: (id) => open.has(id),
      toggle: (id) =>
        change((n) => {
          if (n.has(id)) n.delete(id);
          else n.add(id);
        }),
      setMany: (ids, on) =>
        change((n) => {
          for (const id of ids) {
            if (on) n.add(id);
            else n.delete(id);
          }
        }),
    }),
    [open, change],
  );
  return <OpenCards.Provider value={value}>{children}</OpenCards.Provider>;
}

/** Open state for one card, from the provider, or kept locally when there's none. */
export function useOpenCard(id: string, startOpen = false) {
  const ctx = useContext(OpenCards);
  const [local, setLocal] = useState(startOpen);
  if (!ctx) return { open: local, toggle: () => setLocal((o) => !o), set: (on: boolean) => setLocal(on) };
  return { open: ctx.isOpen(id), toggle: () => ctx.toggle(id), set: (on: boolean) => ctx.setMany([id], on) };
}

export function useOpenCards() {
  return useContext(OpenCards);
}

/**
 * One card on Your account, folded to a line that says what's set. A link that
 * ends in one of its hashes (#jira…) opens it and puts you in its first box.
 */
export function AccountCard({ id, title, summary, pill, howto, children }: { id: string; title: string; summary: ReactNode; pill?: ReactNode; /** The How-to guide's Show me name for this card. */ howto?: string; children: ReactNode }) {
  const { open, toggle, set } = useOpenCard(`acct:${id}`);
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== `#${id}`) return;
      set(true);
      setTimeout(() => {
        const card = document.getElementById(id);
        card?.scrollIntoView({ block: "start" });
        card?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea, select")?.focus({ preventScroll: true });
      }, 50);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return (
    <FoldCard id={id} title={title} summary={summary} pill={pill} open={open} onToggle={toggle} howto={howto}>
      {children}
    </FoldCard>
  );
}

/** Open all / Close all for a set of cards. */
export function OpenAllButton({ ids, className }: { ids: string[]; className?: string }) {
  const ctx = useContext(OpenCards);
  if (!ctx) return null;
  const all = ids.every((id) => ctx.isOpen(id));
  return (
    <button type="button" className={className ?? "text-sm text-accent-700 hover:underline"} onClick={() => ctx.setMany(ids, !all)}>
      {all ? "Close all" : "Open all"}
    </button>
  );
}
