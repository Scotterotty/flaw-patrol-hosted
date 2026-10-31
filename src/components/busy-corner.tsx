"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { busyLabel, CHAIN_MS, GESTURE_MS, opensHere, requestKind, SHOW_AFTER_MS, SLOW_AFTER_MS } from "@/lib/busy";
import { LoadingSpinner } from "./loading-spinner";

/**
 * The corner spinner (ver_116, Scott: "the spinner should appear anytime something loads").
 * Whenever a page you opened or something you pressed takes longer than a third of a second,
 * a thin bar slides along the top and your spinner shows bottom-right with what it's doing.
 * After 10 seconds it adds "Still working, hang tight".
 *
 * It watches two things, so pages need no changes:
 * - link clicks to another page here, until the address changes;
 * - the app's own save and page requests (Next.js sends them with Next-Action / RSC headers)
 *   that start soon after your click, press or key, until their answer has fully arrived.
 * Background polls, prefetches and autosaves don't count. A box with its own spinner
 * (Start a run, Start a new release) marks itself data-own-spinner and the corner stays out.
 */
export function BusyCorner() {
  return (
    <Suspense fallback={null}>
      <Corner />
    </Suspense>
  );
}

type State = { phase: "idle" | "shown" | "slow"; label: string };

function Corner() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState<State>({ phase: "idle", label: "" });
  const [own, setOwn] = useState(false);
  // Shared with the listeners below; refs so they never go stale.
  const t = useRef({
    inflight: 0,
    nav: false,
    navAt: 0,
    gestureAt: 0,
    lastEndAt: 0,
    label: "Working…",
    showTimer: 0 as number | ReturnType<typeof setTimeout>,
    slowTimer: 0 as number | ReturnType<typeof setTimeout>,
    hideTimer: 0 as number | ReturnType<typeof setTimeout>,
    busy: false,
  });
  const sync = useRef<() => void>(() => {});

  useEffect(() => {
    const s = t.current;
    const busyNow = () => s.inflight > 0 || s.nav;
    const update = () => {
      const busy = busyNow();
      if (busy === s.busy) {
        if (busy) clearTimeout(s.hideTimer);
        return;
      }
      if (busy) {
        clearTimeout(s.hideTimer);
        s.busy = true;
        s.showTimer = setTimeout(() => setState({ phase: "shown", label: s.label }), SHOW_AFTER_MS);
        s.slowTimer = setTimeout(() => setState({ phase: "slow", label: s.label }), SLOW_AFTER_MS);
      } else {
        // A short gap between a save and the page reload after it shouldn't blink the corner.
        clearTimeout(s.hideTimer);
        s.hideTimer = setTimeout(() => {
          if (busyNow()) return;
          s.busy = false;
          clearTimeout(s.showTimer);
          clearTimeout(s.slowTimer);
          setState({ phase: "idle", label: "" });
        }, CHAIN_MS);
      }
    };
    sync.current = update;

    const mark = (label: string) => {
      s.gestureAt = Date.now();
      s.label = label;
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const a = el?.closest("a[href]") as HTMLAnchorElement | null;
      if (a) {
        const text = a.getAttribute("aria-label") || a.innerText;
        mark(busyLabel({ kind: "link", text }));
        if (opensHere({ href: a.href, target: a.target, download: a.hasAttribute("download") }, location, { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, button: e.button })) {
          s.nav = true;
          s.navAt = Date.now();
          update();
        }
        return;
      }
      const b = el?.closest("button, [role=button], input[type=submit]") as HTMLElement | null;
      mark(busyLabel(b ? { kind: "button", text: b.getAttribute("aria-label") || b.innerText || (b as HTMLInputElement).value } : null));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") mark(s.gestureAt && Date.now() - s.gestureAt < 50 ? s.label : "Working…");
    };
    const onSubmit = (e: SubmitEvent) => {
      const b = e.submitter as HTMLElement | null;
      mark(busyLabel(b ? { kind: "button", text: b.innerText || (b as HTMLInputElement).value } : null));
    };
    const onChange = () => mark("Working…");
    const onPop = () => mark("Opening…");
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("change", onChange, true);
    window.addEventListener("popstate", onPop);

    // Count the app's own requests that follow something you did.
    const real = window.fetch;
    const patched: typeof fetch = (input, init) => {
      const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      const kind = requestKind(headers as Headers);
      const now = Date.now();
      const yours = !!kind && (now - s.gestureAt < GESTURE_MS || now - s.lastEndAt < CHAIN_MS || s.nav || s.inflight > 0);
      const p = real(input, init);
      if (!yours) return p;
      s.inflight++;
      update();
      const end = () => {
        s.inflight = Math.max(0, s.inflight - 1);
        s.lastEndAt = Date.now();
        update();
      };
      p.then(
        (res) => {
          // Page answers stream in; wait for the last of it, on a copy so the app still reads the original.
          const body = res.body ? res.clone().body : null;
          if (!body) return end();
          const reader = body.getReader();
          const pump = (): Promise<void> => reader.read().then((r) => (r.done ? end() : pump()));
          pump().catch(end);
        },
        end,
      );
      return p;
    };
    window.fetch = patched;
    // Lets tests know the corner is listening.
    document.documentElement.dataset.busyCorner = "on";

    // A link whose page was already loaded, or a click something else handled: let it go.
    const tick = setInterval(() => {
      if (s.nav && s.inflight === 0 && Date.now() - s.navAt > 1500 && Date.now() - s.lastEndAt > 1500) {
        s.nav = false;
        update();
      }
      setOwn(!!document.querySelector("[data-own-spinner]"));
    }, 250);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("popstate", onPop);
      if (window.fetch === patched) window.fetch = real;
      delete document.documentElement.dataset.busyCorner;
      clearInterval(tick);
      clearTimeout(s.showTimer);
      clearTimeout(s.slowTimer);
      clearTimeout(s.hideTimer);
    };
  }, []);

  // The new page is here.
  useEffect(() => {
    const s = t.current;
    if (!s.nav) return;
    s.nav = false;
    sync.current();
  }, [pathname, search]);

  if (state.phase === "idle" || own) return null;
  return (
    <>
      <span className="fp-busy-bar" aria-hidden="true" />
      <div role="status" aria-live="polite" className="fp-busy-pill" data-testid="busy-corner">
        <LoadingSpinner size={36} />
        <span className="min-w-0">
          {state.label}
          {state.phase === "slow" && <span className="ml-1 font-semibold text-amber-700">Still working, hang tight</span>}
        </span>
      </div>
    </>
  );
}
