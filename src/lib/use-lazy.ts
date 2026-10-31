"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A box's data, fetched when the box opens or is about to (ver_120) instead of with the page.
// Boxes on one page with the same key share one fetch, and a fetch is reused for 30 seconds.

type Entry = { at: number; promise: Promise<unknown> };
const store = new Map<string, Entry>();
const FRESH_MS = 30_000;

/** Forget a key, so the next open fetches again (after a change the box's data shows). */
export function forgetLazy(key: string) {
  store.delete(key);
}

export function useLazy<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const fetchRef = useRef(fetcher);
  useEffect(() => {
    fetchRef.current = fetcher;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** Start fetching (hover, focus, touch or open). Does nothing while a fresh fetch is on its way. */
  const load = useCallback(
    (fresh = false) => {
      let e = store.get(key);
      if (fresh || !e || Date.now() - e.at > FRESH_MS) {
        const entry: Entry = { at: Date.now(), promise: fetchRef.current() };
        entry.promise.catch(() => store.get(key) === entry && store.delete(key));
        store.set(key, entry);
        e = entry;
      }
      setFailed(false);
      e.promise.then(
        (d) => mounted.current && setData(d as T),
        () => mounted.current && setFailed(true),
      );
    },
    [key],
  );
  const start = useCallback(() => load(false), [load]);
  const reload = useCallback(() => load(true), [load]);
  /** Fetch only if nothing is shown yet: a box opened again shows what it already has. */
  const ensure = useCallback(() => {
    if (data === null) load();
  }, [data, load]);
  return { data, failed, load: start, ensure, reload };
}

/** The props that start a fetch early, before the click (ver_120): mouse resting on it, Tab, or a finger. */
export function prefetchOn(start: () => void) {
  return { onPointerEnter: start, onFocus: start, onTouchStart: start };
}
