"use client";

import { useEffect, useSyncExternalStore } from "react";

// Names pages give their own breadcrumb (a suite's or run's name), keyed by the page's address.
let names: Record<string, string> = {};
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function useCrumbNames() {
  return useSyncExternalStore(
    subscribe,
    () => names,
    () => names,
  );
}

/** Put on a page to show `label` instead of an id in the top bar breadcrumb. */
export function CrumbName({ href, label }: { href: string; label: string }) {
  useEffect(() => {
    if (names[href] === label) return;
    names = { ...names, [href]: label };
    listeners.forEach((fn) => fn());
  }, [href, label]);
  return null;
}
