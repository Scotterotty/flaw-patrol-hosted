"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setOpenCards } from "@/server/account";
import { FoldCard } from "./fold-card";

type Ctx = { isOpen: (id: string) => boolean; toggle: (id: string) => void; setMany: (ids: string[], on: boolean) => void };
const OpenCards = createContext<Ctx | null>(null);

/**
 * Which folding cards and sections this person keeps open (ver_96), saved on their account
 * so it's the same on every computer. Used by the Account page and the Mini game sections.
 */
export function OpenCardsProvider({ initial, children }: { initial: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(() => new Set(initial));
  // Saved straight away (ver_97): with a short wait, leaving the page right after a click lost it.
  // Next runs server actions one at a time, so quick clicks still save in order.
  const save = useCallback((next: Set<string>) => void setOpenCards([...next]), []);
  const value = useMemo<Ctx>(
    () => ({
      isOpen: (id) => open.has(id),
      toggle: (id) =>
        setOpen((o) => {
          const n = new Set(o);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          save(n);
          return n;
        }),
      setMany: (ids, on) =>
        setOpen((o) => {
          const n = new Set(o);
          for (const id of ids) {
            if (on) n.add(id);
            else n.delete(id);
          }
          save(n);
          return n;
        }),
    }),
    [open, save],
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
 * One card on Your account, folded to a line that says what's set (ver_96). A link that
 * ends in one of its hashes (#jira…) opens it and puts you in its first box.
 */
export function AccountCard({ id, title, summary, pill, children }: { id: string; title: string; summary: ReactNode; pill?: ReactNode; children: ReactNode }) {
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
    <FoldCard id={id} title={title} summary={summary} pill={pill} open={open} onToggle={toggle}>
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
