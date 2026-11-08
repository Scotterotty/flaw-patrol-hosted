"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findHowTo, HOW_TO, HOW_TO_GROUPS, HOW_TO_START, howToById, plainText, type HowToStep, type HowToTask } from "@/lib/how-to";
import { useSpell } from "./spelling";
import { cx } from "./ui";

/**
 * The How-to guide (ver_174): a panel docked on the right that pushes the page over and never
 * covers it. Pick a task; each step with Show me goes to the right page, opens the boxes on the
 * way, makes the real button glow and moves focus to it. Clicking the glowing button moves on to
 * the next step. Esc, or a click anywhere else, stops the glow. It never opens by itself: only
 * "How-to guide" in the left menu and "how do I…" in Search open it (openHowTo).
 */

const EVENT = "fp:how-to";
const STORE = "fp-how-to";

/** Opens the guide, on a task when one is named. */
export function openHowTo(task?: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { task: task ?? null, toggle: false } }));
}

/** The menu link: opens the guide, or closes it when it's open. */
export function toggleHowTo() {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { task: null, toggle: true } }));
}

/** Two weeks of NEW on the menu link, from the build it shipped in. */
export const HOW_TO_NEW_UNTIL = "2026-11-19";

type Saved = { open: boolean; task: string | null; at: number };

const SELECTOR = (name: string) => `[data-howto="${CSS.escape(name)}"]`;
const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const typing = (el: Element) => el.matches("input, textarea, select, [contenteditable=true]");
const pressable = (el: Element) => el.matches("a[href], button, [role=menuitem], summary, label");

/** The button a step is about, on this page now. While a box is open, only what's in it counts. */
function findTarget(name: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(SELECTOR(name))].filter((el) => !el.closest("[data-howto-panel]") && visible(el));
  const dialogs = [...document.querySelectorAll("dialog[open]")];
  const top = dialogs[dialogs.length - 1];
  if (top) return all.find((el) => top.contains(el)) ?? null;
  return all[0] ?? null;
}

/** Waits for the first of these targets to show up. */
function waitFor(names: string[], ms: number): Promise<{ name: string; el: HTMLElement } | null> {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    const tick = () => {
      for (const name of names) {
        const el = findTarget(name);
        if (el) return resolve({ name, el });
      }
      if (Date.now() > end) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function HowToGuide() {
  const spell = useSpell();
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  // The step you're on (-1 before you start), and whether its button is glowing.
  const [at, setAt] = useState(-1);
  const [showing, setShowing] = useState(false);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const task = taskId ? (howToById.get(taskId) ?? null) : null;
  const atRef = useRef(at);
  atRef.current = at;
  const replaying = useRef(false);
  const moving = useRef(false);
  // After a click on a link to another page, the old page may still have the next step's button
  // (Create a run is on a suite's page too). Don't glow anything until the new page is here.
  const leaving = useRef<{ from: string; until: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // Picks up where you were after a full page load (some buttons reload the page).
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as Saved | null;
      if (s?.open) {
        setOpen(true);
        if (s.task && howToById.has(s.task)) {
          setTaskId(s.task);
          setAt(s.at);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ open, task: taskId, at } satisfies Saved));
    } catch {}
  }, [open, taskId, at]);

  // The page makes room for the panel instead of sitting under it.
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.howto = "open";
    else delete root.dataset.howto;
    return () => {
      delete root.dataset.howto;
    };
  }, [open]);

  const stop = useCallback(() => setShowing(false), []);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ task: string | null; toggle: boolean }>).detail;
      if (d.toggle) {
        setOpen((o) => {
          if (o) setShowing(false);
          return !o;
        });
        return;
      }
      setOpen(true);
      setNote("");
      if (d.task && howToById.has(d.task)) {
        setTaskId(d.task);
        setAt(-1);
        setShowing(false);
      }
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // Focus the panel's heading when it opens or the task changes, so keyboard users land in it.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => (task ? heading.current?.focus({ preventScroll: true }) : searchBox.current?.focus({ preventScroll: true })));
  }, [open, task]);

  const step: HowToStep | undefined = task && at >= 0 ? task.steps[at] : undefined;
  // A step with no button of its own (like "Fill in Build if you need it") stays lit in the list
  // while the next step's button glows, so you can carry on without going back to the panel,
  // which a box that's open on the page keeps you from clicking.
  const glowAt = task && at >= 0 ? task.steps.findIndex((x, k) => k >= at && !!x.target) : -1;
  const target = showing && glowAt >= 0 ? task?.steps[glowAt].target : undefined;

  /** Moves on from step i, once, after the click that did it has finished. */
  const advance = useCallback(
    (i: number) => {
      if (atRef.current > i || moving.current || !task) return;
      moving.current = true;
      setTimeout(() => {
        moving.current = false;
        const next = i + 1;
        setAt(next);
        setNote("");
        // The next button glows when it shows up; a step without one is lit in the list meanwhile.
        setShowing(task.steps.slice(next).some((x) => !!x.target));
      }, 0);
    },
    [task],
  );

  // The glow: kept on the step's button as pages change and boxes open, with a small "Click here" tip.
  useEffect(() => {
    if (!target) return;
    let el: HTMLElement | null = null;
    const tip = document.createElement("div");
    tip.className = "fp-howto-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.dataset.testid = "how-to-tip";
    // A frame asked for just before the glow moved on mustn't put the old tip back.
    let dead = false;
    const place = () => {
      if (dead) return;
      const away = leaving.current;
      if (away && (location.href !== away.from || Date.now() > away.until)) leaving.current = null;
      const now = leaving.current ? null : findTarget(target);
      if (now !== el) {
        el?.classList.remove("fp-howto-glow");
        el = now;
      }
      // Always put it back: React rewrites class when the button changes, like Flag turning into Needs updating.
      if (el && !el.classList.contains("fp-howto-glow")) el.classList.add("fp-howto-glow");
      if (!el) {
        tip.remove();
        return;
      }
      const host = el.closest("dialog[open]") ?? document.body;
      if (tip.parentElement !== host) host.appendChild(tip);
      tip.textContent = typing(el) ? "Type here" : pressable(el) ? "Click here" : "Pick here";
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const right = r.right + 14 + w < window.innerWidth - (document.documentElement.dataset.howto ? panelWidth() : 0);
      tip.dataset.side = right ? "right" : "below";
      tip.style.left = `${right ? r.right + 14 : Math.max(8, r.left)}px`;
      tip.style.top = `${right ? r.top + r.height / 2 - 13 : r.bottom + 10}px`;
    };
    place();
    const timer = setInterval(place, 250);
    const watch = new MutationObserver(() => requestAnimationFrame(place));
    watch.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      dead = true;
      clearInterval(timer);
      watch.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      el?.classList.remove("fp-howto-glow");
      tip.remove();
    };
  }, [target]);

  // Clicking the glowing button moves on; a click anywhere else, or Esc, stops the glow.
  useEffect(() => {
    if (!target || !task || glowAt < 0) return;
    const i = glowAt;
    const s = task.steps[i];
    const inGlow = (n: EventTarget | null) => {
      const el = findTarget(target);
      return !!el && n instanceof Node && el.contains(n);
    };
    const onClick = (e: MouseEvent) => {
      if (replaying.current) return;
      if (panel.current?.contains(e.target as Node)) return;
      if (inGlow(e.target)) {
        // Boxes you type in or pick from move on when you've changed them, not on the first click.
        // A tick box or a choice is done with one click, even one that's already picked (it fires no change).
        const pick = e.target instanceof HTMLInputElement && (e.target.type === "radio" || e.target.type === "checkbox");
        if (s.type || (e.target instanceof Element && typing(e.target) && !pick)) return;
        const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (link && !e.defaultPrevented && link.target !== "_blank") {
          const to = new URL(link.href, location.href);
          if (to.origin === location.origin && to.pathname + to.search !== location.pathname + location.search) leaving.current = { from: location.href, until: Date.now() + 15000 };
        }
        advance(i);
      } else stop();
    };
    const onChange = (e: Event) => {
      if (replaying.current || !inGlow(e.target)) return;
      const v = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement ? e.target.value : "x";
      if (v.trim()) advance(i);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
      // Enter in a one-line box you've typed in (like an area name) is done too.
      else if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.value.trim() && inGlow(e.target)) advance(i);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [target, task, glowAt, advance, stop]);

  // Esc stops the glow even before it has found its button.
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowing(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing]);

  /**
   * Show me on step i: if its button isn't on the page, go back to the nearest earlier step whose
   * button is here and press the buttons from there (never one that saves, and never a box you
   * type in), then glow step i's button and move focus to it.
   */
  const showMe = async (i: number) => {
    if (!task || busy) return;
    const steps = task.steps;
    const s = steps[i];
    if (!s.target) return;
    setNote("");
    setShowing(false);
    let el = findTarget(s.target);
    if (!el) {
      let j = i - 1;
      while (j >= 0 && !(steps[j].target && findTarget(steps[j].target!))) j--;
      if (j < 0) {
        const menuFirst = steps.find((x) => x.target)?.target?.startsWith("menu-");
        setAt(i);
        setNote(
          task.start ??
            (menuFirst && !document.querySelector(SELECTOR(steps.find((x) => x.target)!.target!))
              ? "Open an umbrella first: press Flaw Patrol at the top left and pick one. Then press Show me again."
              : "This button isn't on this page yet. Do the steps above first, then press Show me again."),
        );
        return;
      }
      setBusy(true);
      replaying.current = true;
      try {
        for (let k = j; k < i; k++) {
          const st = steps[k];
          if (!st.target) continue;
          const here = findTarget(st.target);
          if (!here) continue;
          // You do this one yourself: it glows, and Show me picks up after it.
          if (st.saves || st.type || typing(here) || !pressable(here)) {
            replaying.current = false;
            setAt(k);
            setShowing(true);
            here.focus({ preventScroll: true });
            here.scrollIntoView({ block: "center", behavior: smooth() });
            setNote(st.saves ? `Do step ${k + 1} first. Then the next button shows up.` : `Start with step ${k + 1}, then carry on from there.`);
            return;
          }
          here.click();
          // The next button this walk needs: wait for it (or for step i's own) to show up.
          const later = steps.slice(k + 1, i + 1).flatMap((x) => (x.target ? [x.target] : []));
          const got = await waitFor(later, 15000);
          if (!got) break;
          await sleep(60);
        }
        el = (await waitFor([s.target], 4000))?.el ?? null;
      } finally {
        replaying.current = false;
        setBusy(false);
      }
      if (!el) {
        setAt(i);
        setNote("I couldn't find that button here. It may need something done first, or you may not have access to it.");
        return;
      }
    }
    setAt(i);
    setShowing(true);
    el.scrollIntoView({ block: "center", behavior: smooth() });
    el.focus({ preventScroll: true });
  };

  const close = () => {
    setOpen(false);
    setShowing(false);
  };

  const shown = useMemo(() => (q.trim() ? findHowTo(q) : HOW_TO), [q]);

  if (!open) return null;
  return (
    <aside ref={panel} data-howto-panel aria-label="How-to guide" className="fp-howto-panel fp-bar" data-testid="how-to-guide">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        {task ? (
          <button
            type="button"
            className="text-sm font-medium text-accent-700 hover:underline"
            onClick={() => {
              setTaskId(null);
              setShowing(false);
              setAt(-1);
              setNote("");
            }}
          >
            ‹ All tasks
          </button>
        ) : (
          <h2 className="font-heading text-base font-semibold text-slate-900">How-to guide</h2>
        )}
        <button type="button" onClick={close} aria-label="Close the How-to guide" title="Close" className="ml-auto rounded-md px-1.5 text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!task ? (
          <>
            <input
              ref={searchBox}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="What do you want to do?"
              aria-label="Search the How-to guide"
              className="mb-3 block h-9 w-full rounded-md border border-slate-300 bg-surface px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
            />
            {shown.length === 0 && <p className="text-sm text-slate-500">Nothing matches. Try one word, like bug, run or import.</p>}
            {(q.trim() ? [null] : HOW_TO_GROUPS).map((g) => {
              const list = g ? shown.filter((t) => t.group === g) : shown;
              if (g === "Start here") list.sort((a, b) => HOW_TO_START.indexOf(a.id) - HOW_TO_START.indexOf(b.id));
              if (!list.length) return null;
              return (
                <section key={g ?? "found"} className="mb-3" aria-label={g ?? "Matching tasks"}>
                  {g && <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g}</h3>}
                  <ul className="space-y-1.5">
                    {list.map((t) => (
                      <li key={t.id}>
                        <TaskButton task={t} spell={spell} onOpen={() => {
                          setTaskId(t.id);
                          setAt(-1);
                          setShowing(false);
                          setNote("");
                        }} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <p className="mt-2 text-xs text-slate-500">Tip: type &ldquo;how do I&rdquo; in Search at the top to find a task from anywhere.</p>
          </>
        ) : (
          <TaskSteps
            task={task}
            at={at}
            glowing={showing ? glowAt : -1}
            busy={busy}
            note={note}
            spell={spell}
            heading={heading}
            onShow={(i) => void showMe(i)}
            onNext={(id) => {
              setTaskId(id);
              setAt(-1);
              setShowing(false);
              setNote("");
            }}
          />
        )}
      </div>
      {/* Read out what to do when a button starts glowing. */}
      <p className="sr-only" aria-live="polite">
        {showing && step ? `Step ${at + 1}: ${spell(plainText(step.text))}` : ""}
      </p>
    </aside>
  );
}

function TaskButton({ task: t, spell, onOpen }: { task: HowToTask; spell: (s: string) => string; onOpen: () => void }) {
  const showMe = t.steps.some((s) => s.target);
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-md border border-slate-200 bg-surface px-3 py-2 text-left hover:border-accent-500 hover:bg-accent-50">
      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
        {spell(t.title)}
        {t.admins && <AdminsTag />}
      </span>
      <span className="block text-xs text-slate-500">
        {spell(t.sub)} · {t.steps.length} steps{showMe ? " · Show me" : ""}
      </span>
    </button>
  );
}

function AdminsTag() {
  return (
    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 ring-inset" title="Only Admins can do this">
      Admins
    </span>
  );
}

function TaskSteps({
  task,
  at,
  glowing,
  busy,
  note,
  spell,
  heading,
  onShow,
  onNext,
}: {
  task: HowToTask;
  at: number;
  /** The step whose button is glowing, or -1. */
  glowing: number;
  busy: boolean;
  note: string;
  spell: (s: string) => string;
  heading: React.RefObject<HTMLHeadingElement | null>;
  onShow: (i: number) => void;
  onNext: (id: string) => void;
}) {
  const next = task.next ? howToById.get(task.next) : undefined;
  const done = at >= task.steps.length;
  return (
    <div data-testid="how-to-task">
      <h2 ref={heading} tabIndex={-1} className="font-heading text-lg font-semibold text-slate-900 outline-none">
        {spell(task.title)}
      </h2>
      <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
        {spell(task.sub)}
        {task.admins && <AdminsTag />}
      </p>
      {task.admins && <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200 ring-inset">Only Admins can do this. If you&apos;re not one, ask an Admin on your team to do it for you.</p>}
      {task.start && <p className="mb-3 rounded-md bg-accent-50 px-3 py-2 text-xs text-accent-800">{spell(task.start)}</p>}
      <ol className="space-y-2">
        {task.steps.map((s, i) => {
          const now = i === at && !done;
          const past = i < at;
          return (
            <li
              key={i}
              data-testid="how-to-step"
              aria-current={now ? "step" : undefined}
              className={cx("relative rounded-lg border bg-surface py-2 pr-2.5 pl-10 text-sm", now ? "fp-howto-now border-amber-400" : "border-slate-200", past && "opacity-70")}
            >
              <span aria-hidden className={cx("absolute top-2 left-2.5 grid size-5 place-items-center rounded-full text-[11px] font-semibold", past ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                {past ? "✓" : i + 1}
              </span>
              <span className="sr-only">{past ? `Step ${i + 1}, done: ` : `Step ${i + 1}: `}</span>
              <span className="text-slate-800">
                <Bold text={spell(s.text)} />
              </span>
              {s.see && (
                <span className="mt-1 block text-xs text-slate-500">
                  <span className="font-medium text-slate-600">You should see: </span>
                  <Bold text={spell(s.see)} />
                </span>
              )}
              {s.target && !past && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onShow(i)}
                  aria-label={`Show me step ${i + 1}`}
                  data-testid="how-to-show-me"
                  className={cx("mt-1.5 rounded-full border border-amber-400 px-2.5 py-0.5 text-xs font-semibold text-slate-800 hover:bg-amber-50 disabled:opacity-60", i === glowing && "bg-amber-100")}
                >
                  {busy && now ? "Finding it…" : i === glowing ? "Showing now" : "Show me"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {note && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200 ring-inset" data-testid="how-to-note">
          {spell(note)}
        </p>
      )}
      {done ? (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset" data-testid="how-to-done">
          You did it. That&apos;s every step.
        </p>
      ) : (
        task.steps.some((s) => s.target) && <p className="mt-3 text-xs text-slate-500">Press Show me and the button glows. Click it to go to the next step. Press Esc to stop the glow.</p>
      )}
      {next && (
        <p className="mt-3 border-t border-slate-200 pt-3 text-sm">
          <span className="text-slate-500">Next task: </span>
          <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => onNext(next.id)}>
            {spell(next.title)} →
          </button>
        </p>
      )}
    </div>
  );
}

/** **Name** shows as bold, for button and page names. */
function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) => (
        <Fragment key={i}>{i % 2 ? <b className="font-semibold text-slate-900">{part}</b> : part}</Fragment>
      ))}
    </>
  );
}

function smooth(): ScrollBehavior {
  return document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function panelWidth() {
  return document.querySelector<HTMLElement>("[data-howto-panel]")?.offsetWidth ?? 0;
}
