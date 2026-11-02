"use client";

import { BusyStrip, SpinnerArt } from "./loading-spinner";
import { RunFieldInputs } from "./run-field-inputs";
import type { RunField } from "@/lib/run-fields";
import { onStartKind, onStartPrefetch, startRunWith } from "@/lib/start-kind";
import { andList } from "@/lib/link-access";
import { releaseKey } from "@/lib/rc-status";
import { prefetchOn, useLazy } from "@/lib/use-lazy";
import { BoxWait } from "./box-wait";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { renamePlatform, setPlatforms, rcPlan, startNextRc } from "@/server/umbrella";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Input } from "./ui";
import { MoreMenu } from "./more-menu";
import { FolderCasePicker, type PickerCase } from "./folder-case-picker";
import { useAction, plural, cap } from "./umbrella-action";

export type RcPlan = {
  umbrella: string;
  hubKey: string;
  suggested: string;
  lastRc: string;
  /** Releases that already have test cycles, and their platforms. */
  releases: { rc: string; platform: string }[];
  /** The umbrella's run fields, asked in the box. */
  runFields: RunField[];
  allSuites: { id: string; name: string; cases: number; caseIds: string[] }[];
  /** The Case library as folders and cases, for Choose from folders…. */
  library: { folders: { id: string; parentId: string | null; name: string }[]; cases: PickerCase[] };
  /** Automated-only cases in the library: suites' runs leave them out unless included. */
  autoCaseIds: string[];
  platforms: {
    name: string;
    suiteIds: string[];
    color: string;
    suites: string[];
    runs: number;
    cases: number;
    prev: { name: string; rc: string } | null;
    testers: string[];
    openBugs: string[];
    /** Runs still open in the last release on this platform. */
    openRuns: number;
    /** Library cases the last release ran here, who had each (by case id), and cases with open bugs. */
    lastCaseIds: string[];
    /** The suites the last test cycle's runs used. */
    lastSuiteIds: string[];
    assign: Record<string, string>;
    bugCaseIds: string[];
    /** Cases picked from folders last time, remembered for this platform. */
    remembered: string[];
  }[];
};

type Plat = RcPlan["platforms"][number];
/** A platform added in the box: nothing from a last release. */
const blankPlatform = (name: string): Plat => ({ name, suiteIds: [], color: "#94a3b8", suites: [], runs: 0, cases: 0, prev: null, testers: [], openBugs: [], openRuns: 0, lastCaseIds: [], lastSuiteIds: [], assign: {}, bugCaseIds: [], remembered: [] });

/** What one platform runs this release (ver_89; cases picked from folders since ver_91). */
type RcChoice = { kind: "suites"; ids: string[] } | { kind: "cases"; ids: string[] } | { kind: "empty" } | { kind: "newsuite"; name: string };

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** "Start next release": one new project per platform, with its runs set up from the shared suites. */
type RcBoxProps = {
  groupId: string;
  /** Can rename or remove platforms, and the suites picked are remembered (umbrella:manage). */
  canManage?: boolean;
  /** Can make a new suite from the box (suite:manage). */
  canSuites?: boolean;
  /** Can write or import cases (case:edit, import): the links in the no-cases note. */
  canCases?: boolean;
  canImport?: boolean;
};

/**
 * Start next release. Since ver_120 the box gets its plan when it opens (or when Start a run's
 * Release candidate is hovered, focused or touched), so the umbrella home doesn't build it every time.
 */
export function StartRcButton({
  umbrella,
  hasRelease,
  variant = "primary",
  hideButton = false,
  ...box
}: RcBoxProps & {
  /** The umbrella's name, for the box's title while it loads. */
  umbrella: string;
  /** Any test cycle yet: "Getting OKO's last release ready…", else "…platforms ready…". */
  hasRelease: boolean;
  /** No button of its own: Start a run's "Release candidate" kind opens it. */
  hideButton?: boolean;
  /** Secondary while the current release still needs its first run. */
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const plan = useLazy(`rc:${box.groupId}`, () => rcPlan(box.groupId));
  const { ensure, load } = plan;
  // The umbrella home's setup list links here (?start=rc) to add platforms and their suites.
  const asked = useSearchParams().get("start") === "rc";
  useEffect(() => {
    if (asked) setOpen(true);
  }, [asked]);
  useEffect(() => onStartKind("rc", () => setOpen(true)), []);
  useEffect(() => onStartPrefetch("rc", () => load()), [load]);
  useEffect(() => {
    if (open) ensure();
  }, [open, ensure]);
  return (
    <>
      {!hideButton && (
        <Button variant={variant} onClick={() => setOpen(true)} {...prefetchOn(load)}>
          {variant === "primary" ? "▶ " : ""}Start next release
        </Button>
      )}
      {plan.data ? (
        <RcBox {...box} plan={plan.data} open={open} setOpen={setOpen} reload={plan.reload} />
      ) : (
        <Modal open={open} onClose={() => setOpen(false)} title={`Start a new release in ${umbrella}`} wide>
          <BoxWait testId="rc-box-wait" failed={plan.failed} onRetry={plan.reload}>
            Getting {umbrella}&apos;s {hasRelease ? "last release" : "platforms"} ready…
          </BoxWait>
        </Modal>
      )}
    </>
  );
}

function RcBox({
  groupId,
  plan,
  open,
  setOpen,
  reload,
  canManage = false,
  canSuites = false,
  canCases = false,
  canImport = false,
}: RcBoxProps & { plan: RcPlan; open: boolean; setOpen: (v: boolean) => void; reload: () => void }) {
  // Nothing is picked for you (Scott, ver_99): the release name, platforms, what each runs and the
  // carry-over all start empty. Last release's choices are offered in each dropdown and as "Use Demo RC 2".
  const [rc, setRc] = useState("");
  // Typing a release that already has test cycles points to Start a run instead.
  const existing = rc.trim() ? (plan.releases ?? []).filter((r) => releaseKey(r.rc) === releaseKey(rc)) : [];
  const order = (p: string) => ((i) => (i < 0 ? 99 : i))(plan.platforms.findIndex((x) => x.name.toLowerCase() === p.toLowerCase()));
  const existingPlatforms = [...new Set(existing.map((r) => r.platform).filter(Boolean))].sort((a, b) => order(a) - order(b));
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [choices, setChoices] = useState<Record<string, RcChoice>>({});
  // Bumped as run fields are typed in, so the still-needed list keeps up.
  const [, setTyped] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  // The platform whose folder tree is open.
  const [tree, setTree] = useState<string | null>(null);
  const [whoGets, setWhoGets] = useState(false);
  const [carry, setCarry] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const [closeOld, setCloseOld] = useState(false);
  // "Also include the automated cases": off, suites' automated-only cases stay out.
  const [withAuto, setWithAuto] = useState(false);
  const autoIds = useMemo(() => new Set(plan.autoCaseIds), [plan.autoCaseIds]);
  // Platforms added here (ver_118: each picks its test cases like the others, keyed new:<id> in choices).
  const [added, setAdded] = useState<{ id: number; name: string }[]>(() => (plan.platforms.length || !canManage ? [] : [{ id: 1, name: "" }]));
  const addPlatform = () => setAdded((l) => [...l, { id: Math.max(0, ...l.map((a) => a.id)) + 1, name: "" }]);
  const newKey = (a: { id: number }) => `new:${a.id}`;
  // No cases in the library yet: new platforms start on No runs yet.
  const noCases = plan.library.cases.length === 0;
  const choiceOf = (key: string): RcChoice | undefined => choices[key] ?? (noCases && key.startsWith("new:") ? { kind: "empty" } : undefined);
  // Back from writing cases or making a suite in another tab: show them here.
  useEffect(() => {
    if (!open || (!noCases && plan.allSuites.length)) return;
    const back = () => reload();
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [open, noCases, plan.allSuites.length, reload]);
  // Platform changes save as they're made: ⋯ Rename, ⋯ Remove (with Undo).
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [removed, setRemoved] = useState<{ at: number; name: string; suiteIds: string[]; color: string }[]>([]);
  const { pending, error, setError, run, router } = useAction(reload);
  // The new release's Test runs page is on its way: the box stays up until that page replaces this one.
  const [opening, setOpening] = useState<string | null>(null);
  const busy = pending || !!opening;
  // Start was pressed: other saves in this box (Rename, Remove) don't show the strip.
  const [pressedStart, setPressedStart] = useState(false);
  useEffect(() => {
    if (!pending) setPressedStart(false);
  }, [pending]);
  const current = () => plan.platforms.map((p) => ({ name: p.name, suiteIds: p.suiteIds }));
  const suiteOf = (id: string) => plan.allSuites.find((s) => s.id === id);
  const caseCount = (_p: Plat, ids: string[]) => [...new Set(ids.flatMap((id) => suiteOf(id)?.caseIds ?? []))].filter((id) => withAuto || !autoIds.has(id)).length;
  // The cases a platform will run with its current choice, for the carry-over counts.
  const casesOf = (p: RcPlan["platforms"][number]): string[] => {
    const c = choices[p.name];
    if (!c) return [];
    if (c.kind === "cases") return c.ids;
    if (c.kind === "suites") return [...new Set(c.ids.flatMap((id) => suiteOf(id)?.caseIds ?? []))].filter((id) => withAuto || !autoIds.has(id));
    // No runs yet: its first run gets last release's testers and bug re-checks.
    return [];
  };
  const keyOf = new Map(plan.library.cases.map((c) => [c.id, c.key]));
  const choose = (name: string, c: RcChoice | null, close = true) => {
    setChoices((all) => {
      const next = { ...all };
      if (c) next[name] = c;
      else delete next[name];
      return next;
    });
    if (close) {
      setMenu(null);
      setTree(null);
    }
  };
  const tick = (name: string) => {
    const on = picked.has(name);
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.delete(name);
      else n.add(name);
      return n;
    });
    // Ticking a platform that hasn't been told what to run opens its dropdown.
    if (!on && !choices[name]) setMenu(name);
    if (on && menu === name) setMenu(null);
  };
  const filled = (c: RcChoice | undefined) => !!c && (c.kind === "empty" || (c.kind === "suites" || c.kind === "cases" ? c.ids.length > 0 : !!c.name.trim()));
  const ready = (name: string) => picked.has(name) && filled(choices[name]);
  const remove = (name: string) => {
    const at = plan.platforms.findIndex((p) => p.name === name);
    const p = plan.platforms[at];
    run(
      () => setPlatforms(groupId, current().filter((x) => x.name !== name)),
      () => {
        setRemoved((r) => [...r, { at, name, suiteIds: p.suiteIds, color: p.color }]);
        setMenu(null);
      },
    );
  };
  const undo = (name: string) => {
    const gone = removed.find((r) => r.name === name)!;
    const list = current();
    list.splice(Math.min(gone.at, list.length), 0, { name: gone.name, suiteIds: gone.suiteIds });
    run(
      () => setPlatforms(groupId, list),
      () => setRemoved((r) => r.filter((x) => x.name !== name)),
    );
  };
  const rename = () => {
    if (!renaming) return;
    const { from, to } = renaming;
    const move = <T,>(o: Record<string, T>) => {
      const n = { ...o };
      if (from in n) {
        n[to.trim()] = n[from];
        delete n[from];
      }
      return n;
    };
    run(
      () => renamePlatform(groupId, from, to),
      () => {
        setRenaming(null);
        setChoices(move);
        setPicked((s) => {
          const n = new Set(s);
          if (n.delete(from)) n.add(to.trim());
          return n;
        });
      },
    );
  };
  const newOnes = added.filter((a) => a.name.trim() && filled(choiceOf(newKey(a))));
  const fieldValue = (f: RunField) => (document.getElementById(f.id === "csp" ? "rc-csp" : `rc-f-${f.id}`) as HTMLInputElement | null)?.value.trim() ?? "";
  const chosen = plan.platforms.filter((p) => ready(p.name));
  const waiting = plan.platforms.filter((p) => picked.has(p.name) && !ready(p.name));
  const starting = [...chosen.map((p) => p.name), ...newOnes.map((a) => a.name.trim())];
  const start = async () => {
    if (newOnes.length) {
      const list = [
        ...current(),
        ...newOnes.map((a) => {
          const c = choiceOf(newKey(a))!;
          return { name: a.name.trim(), suiteIds: c.kind === "suites" ? c.ids : [] };
        }),
      ];
      const saved = await setPlatforms(groupId, list);
      if (!saved.ok) return saved;
    }
    const sent = Object.fromEntries([...chosen.map((p) => [p.name, choices[p.name]]), ...newOnes.map((a) => [a.name.trim(), choiceOf(newKey(a))])]);
    const fields = Object.fromEntries(plan.runFields.map((f) => [f.id, fieldValue(f)]));
    return startNextRc(groupId, { rc, platforms: starting, carryAssignments: carry, recheckBugs: recheck, closeOld: closeOld && openRuns > 0, choices: sent, fields, withAutomated: withAuto });
  };
  // Removed platforms stay in the list, crossed out, until the box closes, so Undo is right there.
  const rows: ({ kind: "live"; p: RcPlan["platforms"][number] } | { kind: "gone"; r: (typeof removed)[number] })[] = plan.platforms.map((p) => ({ kind: "live" as const, p }));
  for (const r of [...removed].sort((a, b) => a.at - b.at)) if (!plan.platforms.some((p) => p.name === r.name)) rows.splice(Math.min(r.at, rows.length), 0, { kind: "gone", r });
  // Same testers on the same cases goes case by case, per platform: who gets how many.
  const split = chosen.map((p) => {
    const c = choices[p.name];
    const later = c?.kind === "empty" || c?.kind === "newsuite";
    const ids = later ? p.lastCaseIds : casesOf(p);
    const by = new Map<string, string[]>();
    let fresh = 0;
    for (const id of ids) {
      const who = p.assign[id];
      if (who) by.set(who, [...(by.get(who) ?? []), id]);
      else fresh++;
    }
    const people = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { p, later, people, fresh };
  });
  const anyAssigned = split.some((x) => x.people.length);
  const testers = split
    .filter((x) => x.people.length)
    .map((x) => `${x.p.name}: ${x.people.map(([who, ids]) => `${who} ${plural(ids.length, "case")}`).join(", ")}`);
  // A bug filed from two platforms counts once.
  const bugs = new Set(chosen.flatMap((p) => p.openBugs)).size;
  // Cases with open bugs that go to the top of each platform's run.
  const bugFirst = chosen
    .map((p) => {
      const ids = new Set(casesOf(p));
      const keys = p.bugCaseIds.filter((id) => ids.has(id)).map((id) => keyOf.get(id) ?? "");
      return keys.length ? `${list(keys.slice(0, 4))}${keys.length > 4 ? " and others" : ""} go to the top of the ${p.name} run` : "";
    })
    .filter(Boolean);
  const laterOnes = split.filter((x) => x.later).map((x) => x.p.name);
  const openRuns = chosen.reduce((n, p) => n + p.openRuns, 0);
  const oldCycles = chosen.filter((p) => p.openRuns > 0 && p.prev).map((p) => p.prev!.name);
  const last = plan.lastRc || "the last release";
  // Carry-over choices that can't apply become one plain line instead of grayed-out ticks.
  const nothing = [bugs === 0 && "no open bugs", openRuns === 0 && "no open runs"].filter(Boolean) as string[];
  // What can't carry over, as one plain sentence: "Nobody was assigned in Demo RC 1 and it has no open bugs, so…"
  const facts = [!anyAssigned && `nobody was assigned in ${last}`, nothing.length && `${anyAssigned ? last : "it"} has ${list(nothing)}`].filter(Boolean) as string[];
  const missingFields = open ? plan.runFields.filter((f) => f.required && !fieldValue(f)) : [];
  // New platforms with a name but nothing picked, or picked but not named.
  const halfAdded = added.filter((a) => !!a.name.trim() !== filled(choiceOf(newKey(a))));
  const namedNew = added.filter((a) => a.name.trim()).map((a) => a.name.trim());
  // What's still needed before Start works.
  const todo: [boolean, string][] = [
    [!!rc.trim(), rc.trim() ? `Release: ${rc.trim()}` : "Name the release"],
    [starting.length > 0 || waiting.length > 0 || namedNew.length > 0, starting.length || waiting.length || namedNew.length ? `Platforms: ${list([...plan.platforms.filter((p) => picked.has(p.name)).map((p) => p.name), ...namedNew])}` : plan.platforms.length ? "Tick a platform" : "Name a platform"],
    ...waiting.map((p): [boolean, string] => [false, `Pick test cases for ${p.name}`]),
    ...halfAdded.map((a): [boolean, string] => [false, a.name.trim() ? `Pick test cases for ${a.name.trim()}` : "Name the new platform"]),
    ...missingFields.map((f): [boolean, string] => [false, `Fill in ${f.name}`]),
  ];
  const allReady = todo.every(([ok]) => ok);
  const leftover = facts.length ? `${cap(facts.join(" and "))}, so there\u2019s nothing ${anyAssigned || bugs > 0 || openRuns > 0 ? "else " : ""}to carry over.` : "";
  // What one platform runs: the same picker for platforms already there and ones added here.
  const picker = (key: string, label: string, p: Plat, isNew = false) => {
    const c = choiceOf(key);
    const ids = c?.kind === "suites" ? c.ids : [];
    const showMenu = menu === key;
    return (
      <>
          <p className="mb-1 text-xs text-slate-500">Test cases for {label}</p>
          <button
            type="button"
            aria-expanded={showMenu}
            aria-label={`Test cases for ${label}`}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-left text-sm text-slate-800"
            onClick={() => {
              setTree(null);
              setMenu(showMenu ? null : key);
            }}
          >
            {summary(key, label, p)}
            <span aria-hidden className="text-slate-400">
              ▾
            </span>
          </button>
          {showMenu && (
            <div className="mt-1 rounded-lg border border-slate-200 bg-surface p-1.5 shadow-lg" role="group" aria-label={`Pick test cases for ${label}`}>
              {!isNew && (
                <>
    <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Last release</p>
                {p.prev && p.lastSuiteIds.length > 0 && !sameIds(p.lastSuiteIds, p.suiteIds) && (
                  <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(key, { kind: "suites", ids: p.lastSuiteIds })}>
                    <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "suites" && sameIds(c.ids, p.lastSuiteIds) ? "✓" : ""}</span>
                    <span>
                      <span className="block font-medium">
                        Same {p.lastSuiteIds.length === 1 ? "suite" : "suites"} as {p.prev.rc}
                      </span>
                      <span className="block text-xs text-slate-500">{p.lastSuiteIds.map((id) => suiteOf(id)?.name ?? "").join(", ")}</span>
                    </span>
                  </button>
                )}
                {p.prev && p.suiteIds.length ? (
                  <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(key, { kind: "suites", ids: p.suiteIds })}>
                    <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "suites" && sameIds(c.ids, p.suiteIds) ? "✓" : ""}</span>
                    <span>
                      <span className="block font-medium">Run {p.prev.rc || last}&apos;s suites again</span>
                      <span className="block text-xs text-slate-500">
                        {p.suites.join(", ")} · {plural(p.cases, "case")}
                      </span>
                    </span>
                  </button>
                ) : !p.lastCaseIds.length ? (
                  <p className="px-2 pb-1.5 text-xs text-slate-500">{p.prev ? `No suites were saved for ${label}.` : `${label} wasn't in ${last}.`}</p>
                ) : null}
                {p.prev && p.lastCaseIds.length > 0 && (
                  <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(key, { kind: "cases", ids: p.lastCaseIds })}>
                    <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "cases" && sameIds(c.ids, p.lastCaseIds) ? "✓" : ""}</span>
                    <span>
                      <span className="block font-medium">
                        Same {plural(p.lastCaseIds.length, "case")} as {p.prev.rc || last}
                      </span>
                      <span className="block text-xs text-slate-500">Every case {label} ran last release, from any folder or suite</span>
                    </span>
                  </button>
                )}
                </>
              )}
              <>
                  <p className={cx("px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase", !isNew && "mt-1 border-t border-slate-100")}>Suites in {plan.umbrella}</p>
                  {!plan.allSuites.length && (
                    <p className="px-2 pb-1.5 text-xs text-slate-500" data-testid="no-suites-yet">
                      None yet. You don&apos;t need one: pick cases below{canSuites ? ", or start a new suite" : ""}.
                    </p>
                  )}
                  {plan.allSuites.map((s) => {
                    const has = ids.includes(s.id);
                    return (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="accent-accent-600"
                          checked={has}
                          onChange={() => {
                            const next = has ? ids.filter((x) => x !== s.id) : [...ids, s.id];
                            choose(key, next.length ? { kind: "suites", ids: next } : null, false);
                          }}
                        />
                        <span className="flex-1">{s.name}</span>
                        <span className="text-xs text-slate-500">{plural(s.cases, "case")}</span>
                      </label>
                    );
                  })}
              </>
              <p className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Pick cases</p>
              <button
                type="button"
                className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={noCases}
                onClick={() => {
                  if (c?.kind !== "cases") choose(key, null, false);
                  setTree(key);
                  setMenu(null);
                }}
              >
                <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "cases" && !sameIds(c.ids, p.lastCaseIds) ? "✓" : ""}</span>
                <span>
                  <span className="block font-medium">Choose from folders…</span>
                  <span className="block text-xs text-slate-500">{noCases ? "No cases yet" : `Tick whole folders or single cases · ${plural(plan.library.cases.length, "case")}${plan.library.folders.length ? ` in ${plural(plan.library.folders.length, "folder")}` : ""}`}</span>
                </span>
              </button>
              <p className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Start brand new</p>
              <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(key, { kind: "empty" })}>
                <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "empty" ? "✓" : "＋"}</span>
                <span>
                  <span className="block font-medium text-sky-800">No runs yet</span>
                  <span className="block text-xs text-slate-500">Makes the test cycle with no runs. Start runs in it from its page once the release is made.</span>
                </span>
              </button>
              {canSuites && (
                <div className="rounded-md px-2 py-1.5 text-sm">
                  <button type="button" className="flex w-full gap-2 text-left" onClick={() => choose(key, { kind: "newsuite", name: c?.kind === "newsuite" ? c.name : "" }, false)}>
                    <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "newsuite" ? "✓" : "＋"}</span>
                    <span>
                      <span className="block font-medium text-sky-800">New suite…</span>
                      <span className="block text-xs text-slate-500">Name it here. It&apos;s made empty in the {plan.umbrella} library: add its cases, then start its run in the test cycle.</span>
                    </span>
                  </button>
                  {c?.kind === "newsuite" && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
                      <Input
                        aria-label="New suite name"
                        autoFocus
                        maxLength={100}
                        className="h-8 w-56"
                        value={c.name}
                        placeholder={`${label} ${rc.trim() || "release"} checks`}
                        onChange={(e) => choose(key, { kind: "newsuite", name: e.target.value }, false)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && c.name.trim()) setMenu(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 px-2 pt-2">
                <span className="text-xs text-slate-500">{canManage ? `What you pick is remembered for ${label}'s next release.` : ""}</span>
                <Button size="sm" onClick={() => setMenu(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
          {tree === key && (
            <FolderCasePicker
              title={`Choose ${label}'s cases`}
              folders={plan.library.folders}
              cases={plan.library.cases}
              value={c?.kind === "cases" ? c.ids : []}
              onChange={(ids) => choose(key, ids.length ? { kind: "cases", ids } : null, false)}
              onDone={() => setTree(null)}
            />
          )}
      </>
    );
  };
  // What Start makes for one platform, in the "Pressing Start creates" list.
  const makes = (c: RcChoice, p: Plat) =>
    c.kind === "suites"
      ? `with ${plural(c.ids.length, "run")} of ${list(c.ids.map((id) => suiteOf(id)?.name ?? ""))} · ${plural(caseCount(p, c.ids), "case")}`
      : c.kind === "cases"
        ? `with 1 run · ${plural(c.ids.length, "case")}`
        : c.kind === "empty"
          ? "with no runs yet"
          : `with no runs yet · new empty suite ${c.name.trim()} in the library`;
  const summary = (key: string, label: string, p: Plat) => {
    const c = choiceOf(key);
    if (!c || ((c.kind === "suites" || c.kind === "cases") && !c.ids.length)) return <span className="text-slate-500">Pick test cases for {label || "the new platform"}…</span>;
    if (c.kind === "cases") {
      const same = p.lastCaseIds.length > 0 && sameIds(c.ids, p.lastCaseIds);
      return (
        <span>
          {same ? (
            <>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">Same cases as {p.prev?.rc || last}</span> {plural(c.ids.length, "case")}
            </>
          ) : (
            <>Cases from folders · {c.ids.length} picked</>
          )}
        </span>
      );
    }
    if (c.kind === "empty")
      return (
        <span>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">＋ No runs yet</span> <span className="text-slate-500">start runs in it later</span>
        </span>
      );
    if (c.kind === "newsuite")
      return (
        <span>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">＋ New suite</span> {c.name.trim() || "Untitled suite"}
        </span>
      );
    const ranLast = !!p.prev && p.lastSuiteIds.length > 0 && sameIds(c.ids, p.lastSuiteIds);
    const again = ranLast || (!!p.prev && p.suiteIds.length > 0 && sameIds(c.ids, p.suiteIds));
    return (
      <span>
        {again && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
            Same {c.ids.length === 1 ? "suite" : "suites"} as {p.prev!.rc || last}
          </span>
        )}{" "}
        {c.ids.map((id) => suiteOf(id)?.name ?? "").join(", ")} · {plural(caseCount(p, c.ids), "case")}
      </span>
    );
  };
  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setRemoved([]);
          setMenu(null);
        }}
        title={`Start a new release in ${plan.umbrella}`}
        wide
        locked={busy}
      >
        <p className="text-sm text-slate-500">
          For testing a release candidate: makes one test cycle per platform in one go. Cases, suites, Jira and members come from {plan.umbrella}. For any
          other testing, like a sprint, a smoke check or a retest, use <b>Start a run</b>.
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {noCases && (
          <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="rc-no-cases">
            <p>
              {plan.umbrella} has no test cases yet. You can still start the release now: each platform starts with <b>No runs yet</b>
              {canSuites ? " or a new empty suite" : ""}, and you add runs once cases are written.
            </p>
            {(canCases || canImport) && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {canCases && (
                  <a href={`/p/${plan.hubKey}/cases/new`} target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
                    Write the first case ↗
                  </a>
                )}
                {canImport && (
                  <a href={`/p/${plan.hubKey}/import`} target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
                    Import cases ↗
                  </a>
                )}
                <span className="text-xs text-sky-800">opens a new tab, so this box stays as it is</span>
              </p>
            )}
          </div>
        )}
        {(
          <>
            <div className="mt-3 max-w-md">
              <Field
                label="Release"
                htmlFor="rc-name"
                hint={
                  plan.suggested && rc.trim() !== plan.suggested ? (
                    <span className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900" data-testid="rc-suggest">
                      <span>
                        The last one was <b>{plan.lastRc}</b>.
                      </span>
                      <Button size="sm" onClick={() => setRc(plan.suggested)}>
                        Use {plan.suggested}
                      </Button>
                    </span>
                  ) : undefined
                }
              >
                <Input id="rc-name" value={rc} onChange={(e) => setRc(e.target.value)} placeholder="e.g. 2.1 or RC 22" />
              </Field>
            </div>
            {existing.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="rc-release-exists">
                <span className="min-w-0 flex-1">
                  {plan.umbrella} already has {rc.trim()} test cycles{existingPlatforms.length ? ` for ${andList(existingPlatforms)}` : ""}. To test in them, use <b>Start a run</b> and set Release to {rc.trim()}.
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const release = rc.trim();
                    setOpen(false);
                    if (!startRunWith(release)) router.push(`/g/${groupId}?start=run&release=${encodeURIComponent(release)}`);
                  }}
                >
                  Start a run instead
                </Button>
              </div>
            )}
            <p className="mt-4 mb-1.5 text-sm font-medium text-slate-700">
              Platforms <span className="font-normal text-slate-500">· tick the ones testing this release, then pick the test cases each one tests</span>
            </p>
            <div className="space-y-2">
              {rows.map((row) => {
                if (row.kind === "gone") {
                  const r = row.r;
                  return (
                    <div key={`gone-${r.name}`} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 opacity-60" data-testid="platform-row">
                      <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
                      <span className="text-sm font-medium text-slate-900 line-through">{r.name}</span>
                      <span className="min-w-0 flex-1 text-xs text-slate-500 line-through">Removed from {plan.umbrella}&apos;s platforms</span>
                      <button type="button" className="text-xs font-medium text-accent-700 underline" disabled={pending} onClick={() => undo(r.name)}>
                        Undo
                      </button>
                    </div>
                  );
                }
                const p = row.p;
                const on = picked.has(p.name);
                return (
                  <div key={p.name} className={cx("rounded-lg border px-3 py-2.5", on ? "border-accent-500 bg-accent-50/50" : "border-slate-200")} data-testid="platform-row">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <input type="checkbox" className="size-4 accent-accent-600" aria-label={p.name} checked={on} onChange={() => tick(p.name)} />
                      <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
                      {renaming?.from === p.name ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Input
                            aria-label={`New name for ${p.name}`}
                            value={renaming.to}
                            maxLength={30}
                            autoFocus
                            className="h-8 w-40"
                            onChange={(e) => setRenaming({ from: p.name, to: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") rename();
                              if (e.key === "Escape") setRenaming(null);
                            }}
                          />
                          <Button size="sm" variant="primary" disabled={pending || !renaming.to.trim()} onClick={rename}>
                            Rename
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                      )}
                      <span className="min-w-0 flex-1 text-xs text-slate-500">{on ? null : p.runs ? `${p.suites.join(", ")} · ${plural(p.cases, "case")}` : "No cases picked yet"}</span>
                      {canManage && (
                        <MoreMenu label="⋯" title={`More for ${p.name}`}>
                          <Button onClick={() => setRenaming({ from: p.name, to: p.name })}>Rename platform…</Button>
                          <Button onClick={() => remove(p.name)}>Remove from {plan.umbrella}</Button>
                        </MoreMenu>
                      )}
                    </div>
                    {on && (
                      <div className="mt-2 max-w-md pl-6">
                        {picker(p.name, p.name, p)}
                      </div>
                    )}
                  </div>
                );
              })}
              {added.map((a) => {
                const key = newKey(a);
                return (
                  <div key={key} className="rounded-lg border border-dashed border-slate-300 p-2" data-testid="new-platform-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Platform name"
                        value={a.name}
                        onChange={(e) => setAdded((l) => l.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
                        placeholder="Platform name"
                        maxLength={30}
                        className="w-44"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAdded((l) => l.filter((x) => x.id !== a.id));
                          choose(key, null);
                        }}
                        aria-label="Remove this platform"
                      >
                        ✕ Remove
                      </Button>
                    </div>
                    <div className="mt-2 max-w-md">{picker(key, a.name.trim(), blankPlatform(a.name.trim()), true)}</div>
                    <p className="mt-1.5 text-xs text-slate-500">Added to {plan.umbrella}&apos;s platforms, so it shows up everywhere you pick a platform.</p>
                  </div>
                );
              })}
              {!plan.platforms.length && !canManage && (
                <p className="text-sm text-slate-500">{plan.umbrella} has no platforms yet. Someone who manages {plan.umbrella} adds them here.</p>
              )}
              {canManage && (
                <Button size="sm" variant="ghost" onClick={addPlatform}>
                  ＋ New platform
                </Button>
              )}
            </div>
            {plan.platforms.some((p) => p.prev) && (
              <>
                <p className="mt-4 mb-1.5 text-sm font-medium text-slate-700">
                  Bring anything from {last}? <span className="font-normal text-slate-500">(optional)</span>
                </p>
                {chosen.length === 0 ? (
                  <p className="px-0.5 text-sm text-slate-500">Tick a platform to see what carries over.</p>
                ) : (
                <div className="space-y-2">
                  {anyAssigned && (
                  <Tick
                    on={carry}
                    toggle={() => setCarry(!carry)}
                    title="Same testers on the same cases"
                    sub={
                      anyAssigned ? (
                        <>
                          Case by case, per platform. {testers.join(". ")}.
                          {split.some((x) => x.fresh && x.people.length) ? " New cases start unassigned." : ""}{" "}
                          <button
                            type="button"
                            className="font-medium text-accent-700 underline"
                            aria-expanded={whoGets}
                            onClick={(e) => {
                              e.preventDefault();
                              setWhoGets(!whoGets);
                            }}
                          >
                            {whoGets ? "Hide who gets what" : "See who gets what"}
                          </button>
                        </>
                      ) : null
                    }
                  />
                  )}
                  {whoGets && anyAssigned && (
                    <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700" data-testid="who-gets-what">
                      {split
                        .filter((x) => x.people.length || x.fresh)
                        .map((x) => (
                          <div key={x.p.name} className="py-1">
                            <p className="font-semibold text-slate-900">{x.p.name}{x.later ? " (its first run)" : ""}</p>
                            <ul className="mt-0.5 space-y-0.5">
                              {x.people.map(([who, ids]) => (
                                <li key={who}>
                                  <span className="font-medium">{who}</span>: {ids.map((id) => keyOf.get(id)).join(", ")}
                                </li>
                              ))}
                              {x.fresh > 0 && <li className="text-slate-500">Unassigned: {plural(x.fresh, "case")}</li>}
                            </ul>
                          </div>
                        ))}
                    </div>
                  )}
                  {bugs > 0 && (
                    <Tick
                      on={recheck}
                      toggle={() => setRecheck(!recheck)}
                      title={`Re-check ${last}'s ${bugs} open ${bugs === 1 ? "bug" : "bugs"} first`}
                      sub={bugFirst.length ? `${bugFirst.join(". ")}, with "Bug still occurs" ready in each case's history.` : 'Their cases are put first, with "Bug still occurs" ready in each case\'s history'}
                    />
                  )}
                  {openRuns > 0 && (
                    <Tick
                      on={closeOld}
                      toggle={() => setCloseOld(!closeOld)}
                      title={`Close ${last}'s ${openRuns} open ${openRuns === 1 ? "run" : "runs"}`}
                      sub={`In ${list(oldCycles)}. Each can be reopened from its run page's More menu.`}
                    />
                  )}
                  {leftover && <p className="px-0.5 text-sm text-slate-500">{leftover}</p>}
                  {laterOnes.length > 0 && (carry || recheck) && (
                    <p className="px-0.5 text-sm text-slate-500">
                      {list(laterOnes)} {laterOnes.length === 1 ? "has" : "have"} no runs yet: testers and bug re-checks apply when you start {laterOnes.length === 1 ? "its" : "their"} first run.
                    </p>
                  )}
                </div>
                )}
              </>
            )}
            {(() => {
              // Automated cases in the suites picked, which the tick box brings in.
              const ids = new Set(
                [...chosen.map((p) => choices[p.name]), ...newOnes.map((a) => choiceOf(newKey(a)))].flatMap((c) => (c?.kind === "suites" ? c.ids.flatMap((id) => suiteOf(id)?.caseIds ?? []) : [])),
              );
              const n = [...ids].filter((id) => autoIds.has(id)).length;
              return n > 0 ? (
                <div className="mt-3" data-testid="with-auto">
                  <Tick
                    on={withAuto}
                    toggle={() => setWithAuto(!withAuto)}
                    title={`Also include the ${n === 1 ? "automated case" : `${n} automated cases`} in these suites`}
                    sub={`🤖 Your automation already runs ${n === 1 ? "it" : "these"} and sends the results in. Tick this only if someone will check ${n === 1 ? "it" : "them"} by hand too.`}
                  />
                </div>
              ) : null;
            })()}
            {rc.trim() && starting.length > 0 && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <p className="mb-1.5 text-sm font-medium text-slate-700">Pressing Start creates</p>
                <ul className="space-y-1.5 text-sm">
                  {chosen.map((p) => {
                    const c = choices[p.name];
                    return (
                      <li key={p.name} className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-700">Test cycle</span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-2 py-0.5 text-xs text-slate-800">
                          <span className="size-1.5 rounded-full" style={{ background: p.color }} aria-hidden />
                          {plan.umbrella} {p.name} {rc.trim()}
                        </span>
                        <span className="text-slate-500">{makes(c, p)}</span>
                      </li>
                    );
                  })}
                  {newOnes.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-700">Test cycle</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-2 py-0.5 text-xs text-slate-800">
                        {plan.umbrella} {a.name.trim()} {rc.trim()}
                      </span>
                      <span className="text-slate-500">{makes(choiceOf(newKey(a))!, blankPlatform(a.name.trim()))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.runFields.length > 0 && (
              <div className="mt-4 grid items-start gap-3 sm:grid-cols-2" onInput={() => setTyped((t) => t + 1)} data-testid="rc-fields">
                <RunFieldInputs fields={plan.runFields} prefix="rc" />
              </div>
            )}
          </>
        )}
        {/* Your spinner from the moment you press Start, then "Opening Test runs…". */}
        {(opening || (pending && pressedStart)) && (
          <BusyStrip className="mt-4" testId={opening ? "run-opening" : "run-making"}>
            {opening ? (
              <p>
                <b>{opening}</b> is ready. Opening Test runs…
              </p>
            ) : (
              <>
                <p>
                  <b>Starting {rc.trim() || "the release"}…</b>
                </p>
                <p className="text-xs text-slate-600">Making {plural(starting.length, "test cycle")} and their runs</p>
              </>
            )}
          </BusyStrip>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <ul className="space-y-0.5 text-xs" aria-live="polite" data-testid="rc-todo">
            {todo.map(([ok, text]) => (
              <li key={text} className={ok ? "text-slate-700" : "text-slate-500"}>
                <span className={cx("mr-1", ok ? "text-emerald-600" : "text-slate-400")} aria-hidden>
                  {ok ? "✓" : "○"}
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setRemoved([]);
              setMenu(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !allReady}
            onClick={() => {
              setPressedStart(true);
              run(
                start,
                (r: { made: { key: string }[] }) => {
                  if (r.made.length !== 1) return setOpen(false);
                  // One test cycle: its Test runs page, with "Opening…" in the box until it shows.
                  setOpening(rc.trim() || "The release");
                  router.push(`/p/${r.made[0].key}/runs`);
                  return true;
                },
              );
            }}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <SpinnerArt id="ring" size={14} />
                {opening ? "Opening…" : "Starting…"}
              </span>
            ) : `Start ${rc.trim() || "release"}${starting.length ? ` · ${plural(starting.length, "platform")}` : ""}`}
          </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function list(names: string[]) {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function Tick({
  on,
  toggle,
  title,
  sub,
  aside,
  disabled,
}: {
  on: boolean;
  toggle: () => void;
  title: string;
  sub: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        on && !disabled
          ? "border-accent-500 bg-accent-50/50"
          : "border-slate-200",
        disabled ? "opacity-60" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        className="size-4 accent-accent-600"
        checked={on && !disabled}
        disabled={disabled}
        onChange={toggle}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>
      </span>
      {aside}
    </label>
  );
}
