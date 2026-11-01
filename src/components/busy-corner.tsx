"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { actionRedirect, busyLabel, CHAIN_MS, GESTURE_MS, LINE_AFTER_MS, movesPage, opensHere, requestKind, samePath, SHOW_AFTER_MS, SLOW_AFTER_MS } from "@/lib/busy";
import { LoadingSpinner } from "./loading-spinner";

/**
 * Loading signs (ver_116, Scott: "the spinner should appear anytime something loads"; ver_130,
 * Scott: keep them out of the way).
 * - Moving to another page (a link, a left menu item, a library tab, Back or Forward, or a save
 *   that takes you to a new page): after a third of a second a thin line slides along the top
 *   and your spinner shows bottom-right with where you're going. After 10 seconds it adds
 *   "Still working, hang tight".
 * - Things you do on a page (a result, Save, a tick, a filter or sort): only the thin line,
 *   after about 0.15 seconds, so nothing covers the buttons you're using. After 10 seconds a
 *   small "Still saving, hang tight" tag shows at the top middle, under the line.
 *
 * It watches two things, so pages need no changes:
 * - link clicks to another page here, until the address changes;
 * - the app's own save and page requests (Next.js sends them with Next-Action / RSC headers)
 *   that start soon after your click, press or key, until their answer has fully arrived.
 * Background polls, prefetches and autosaves don't count. A box with its own spinner
 * (Start a run, Start a new release) marks itself data-own-spinner and the signs stay out.
 */
export function BusyCorner() {
  return (
    <Suspense fallback={null}>
      <Corner />
    </Suspense>
  );
}

type State = { line: boolean; pill: boolean; slow: boolean; label: string; saving: boolean };
const IDLE: State = { line: false, pill: false, slow: false, label: "", saving: false };

function Corner() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState<State>(IDLE);
  const [own, setOwn] = useState(false);
  // Shared with the listeners below; refs so they never go stale.
  const t = useRef({
    inflight: 0,
    actions: 0,
    nav: false,
    navAt: 0,
    gestureAt: 0,
    lastEndAt: 0,
    label: "Working…",
    lineTimer: 0 as number | ReturnType<typeof setTimeout>,
    pillTimer: 0 as number | ReturnType<typeof setTimeout>,
    slowTimer: 0 as number | ReturnType<typeof setTimeout>,
    hideTimer: 0 as number | ReturnType<typeof setTimeout>,
    busy: false,
    pillPending: false,
  });
  const sync = useRef<() => void>(() => {});
  const shownPath = useRef("");
  shownPath.current = pathname;

  useEffect(() => {
    const s = t.current;
    const busyNow = () => s.inflight > 0 || s.nav;
    const update = () => {
      const busy = busyNow();
      // The corner spinner only while moving to another page.
      if (s.nav && !s.pillPending) {
        s.pillPending = true;
        clearTimeout(s.pillTimer);
        s.pillTimer = setTimeout(() => setState((v) => ({ ...v, line: true, pill: true, label: s.label })), Math.max(0, SHOW_AFTER_MS - (Date.now() - s.navAt)));
      } else if (!s.nav && s.pillPending) {
        s.pillPending = false;
        clearTimeout(s.pillTimer);
        setState((v) => (v.pill ? { ...v, pill: false } : v));
      }
      if (busy === s.busy) {
        if (busy) clearTimeout(s.hideTimer);
        return;
      }
      if (busy) {
        clearTimeout(s.hideTimer);
        s.busy = true;
        s.lineTimer = setTimeout(() => setState((v) => ({ ...v, line: true })), s.nav ? SHOW_AFTER_MS : LINE_AFTER_MS);
        s.slowTimer = setTimeout(() => setState((v) => ({ ...v, line: true, slow: true, label: s.label, saving: s.actions > 0 })), SLOW_AFTER_MS);
      } else {
        // A short gap between a save and the page reload after it shouldn't blink the signs.
        clearTimeout(s.hideTimer);
        s.hideTimer = setTimeout(() => {
          if (busyNow()) return;
          s.busy = false;
          s.pillPending = false;
          clearTimeout(s.lineTimer);
          clearTimeout(s.pillTimer);
          clearTimeout(s.slowTimer);
          setState(IDLE);
        }, CHAIN_MS);
      }
    };
    sync.current = update;
    const startNav = (label?: string) => {
      if (label) s.label = label;
      else if (!/^Opening/.test(s.label)) s.label = "Opening…";
      if (!s.nav) s.navAt = Date.now();
      s.nav = true;
      update();
    };

    const mark = (label: string) => {
      s.gestureAt = Date.now();
      s.label = label;
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const a = el?.closest("a[href]") as HTMLAnchorElement | null;
      if (a) {
        const text = a.getAttribute("aria-label") || a.innerText;
        const keys = { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, button: e.button };
        const link = { href: a.href, target: a.target, download: a.hasAttribute("download") };
        if (movesPage(link, location, keys)) {
          mark(busyLabel({ kind: "link", text }));
          startNav();
        } else if (opensHere(link, location, keys)) {
          // A filter or sort link on this page: the line only.
          mark("Working…");
        } else mark(busyLabel({ kind: "link", text }));
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
    const onPop = () => {
      mark("Opening…");
      // Back or Forward to another page; only the #part or ?filters changing is the line only.
      if (shownPath.current && samePath(location.href, new URL(shownPath.current, location.href).href) === false) startNav("Opening…");
    };
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
      // A page answer for another address (a button that opens a page) is a page move.
      if (kind === "page") {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (samePath(url, location.href) === false) startNav();
      }
      const isAction = kind === "action";
      s.inflight++;
      if (isAction) s.actions++;
      update();
      const end = () => {
        s.inflight = Math.max(0, s.inflight - 1);
        if (isAction) s.actions = Math.max(0, s.actions - 1);
        s.lastEndAt = Date.now();
        update();
      };
      p.then(
        (res) => {
          // A save that takes you to a new page (Save and finish) counts as moving pages.
          const to = isAction ? actionRedirect(res.headers.get("x-action-redirect")) : null;
          if (to && samePath(to, location.href) === false) startNav();
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
      clearTimeout(s.lineTimer);
      clearTimeout(s.pillTimer);
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

  if (!state.line || own) return null;
  return (
    <>
      <span className="fp-busy-bar" aria-hidden="true" data-testid="busy-line" />
      {state.pill ? (
        <div role="status" aria-live="polite" className="fp-busy-pill" data-testid="busy-corner">
          <LoadingSpinner size={36} />
          <span className="min-w-0">
            {state.label}
            {state.slow && <span className="ml-1 font-semibold text-amber-700">Still working, hang tight</span>}
          </span>
        </div>
      ) : (
        state.slow && (
          <div role="status" aria-live="polite" className="fp-busy-slow" data-testid="busy-slow">
            {state.saving ? "Still saving, hang tight" : "Still loading, hang tight"}
          </div>
        )
      )}
    </>
  );
}
