"use client";

import { TagPills } from "./tag-pill";
import { NewsTag } from "./case-news-tag";
import { AutomatedBadge } from "./badges";
import { forgivingFilter, tagHits } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/format";
import { onStartRun, startKind, startPrefetch } from "@/lib/start-kind";
import { prefetchOn } from "@/lib/use-lazy";
import { addRunKind, askAccessFromRunBox, createCycleFromRunBox, runBoxOptions, startRuns, type RunBoxOptions, type RunBoxScope } from "@/server/start-run";
import { Modal } from "./modal";
import { BusyStrip, SpinnerArt } from "./loading-spinner";
import { RunFieldInputs } from "./run-field-inputs";
import { CantFindCase, FolderList, inFolder } from "./folder-list";
import { PlatformPicker } from "./platform-picker";
import { firstSheetTarget, handOffSheet, SheetPick, SheetWhere, type PickedSheet, type SheetTarget } from "./start-run-sheet";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select, Textarea } from "./ui";
import { runTitle } from "@/lib/run-label";

type What = "all" | "suite" | "cases" | "sheet";
export type RunBoxPreset = { what: "all" } | { what: "suite"; suiteId: string } | { what: "cases"; caseIds: string[] } | { what: "sheet" };

/**
 * "Create a run": one box everywhere. Pick what to run from the library
 * (all of it, a suite, or ticked cases), then the test cycles to run it in.
 * The box loads its choices when it opens.
 */
export function StartRunBox({
  scope,
  preset,
  label = "Create a run",
  variant = "primary",
  size,
  defaultName,
  initialOpen = false,
  disabled,
  session,
  openParam,
}: {
  scope: RunBoxScope;
  /** Already picked, e.g. the cases ticked in the Case library. */
  preset?: RunBoxPreset;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  defaultName?: string;
  initialOpen?: boolean;
  disabled?: boolean;
  /** An exploratory charter: the box says "Start session". */
  session?: boolean;
  /** Opens by itself when the page link has ?start=<this> (ver_95: the setup card's Create a run). */
  openParam?: string;
}) {
  const [open, setOpen] = useState(initialOpen && !disabled);
  // Starting and opening the run: the box stays up and can't be closed until the run page shows.
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const asked = params.get("start");
  // Release filled in when the release box's "Create a run instead" opened this.
  const [release, setRelease] = useState("");
  // ?start=run&what=sheet (Ctrl+K "Update a run from a sheet"): opens on From a spreadsheet.
  const [sheetAsked, setSheetAsked] = useState(false);
  useEffect(() => {
    if (openParam && asked === openParam && !disabled) {
      setRelease(params.get("release") ?? "");
      setSheetAsked(params.get("what") === "sheet");
      setOpen(true);
    }
  }, [asked, openParam, disabled, params]);
  useEffect(
    () =>
      openParam && !disabled
        ? onStartRun((r) => {
            setRelease(r);
            setOpen(true);
          })
        : undefined,
    [openParam, disabled],
  );
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => {
          setRelease("");
          setSheetAsked(false);
          setOpen(true);
        }}
        disabled={disabled}
        data-howto={session ? undefined : "run-create"}
      >
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={session ? "Start a session" : "Create a run"} wide locked={busy}>
        <Box scope={scope} preset={sheetAsked ? { what: "sheet" } : preset} defaultName={defaultName} session={session} release={release} onClose={() => setOpen(false)} onBusy={setBusy} />
      </Modal>
    </>
  );
}

function Box({
  scope,
  preset,
  defaultName,
  session,
  release,
  onClose,
  onBusy,
}: {
  scope: RunBoxScope;
  preset?: RunBoxPreset;
  defaultName?: string;
  session?: boolean;
  release?: string;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [opts, setOpts] = useState<RunBoxOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    runBoxOptions(scope).then((r) => {
      if (!live) return;
      if (r.ok) setOpts(r);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
    // The scope is plain data that doesn't change while the box is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!opts)
    return (
      <div className="space-y-3">
        {error?.startsWith("You're a Viewer") ? (
          <ViewerAsk scope={scope} line={error} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">Loading the library…</p>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  return <Form opts={opts} preset={preset} defaultName={defaultName} session={session} initialRelease={release} onClose={onClose} onBusy={onBusy} />;
}

/** A Viewer who opens the box: why they can't, and the way up, not a dead end. */
function ViewerAsk({ scope, line }: { scope: RunBoxScope; line: string }) {
  const [state, setState] = useState<"idle" | "asking" | "asked">("idle");
  const [error, setError] = useState<string | null>(null);
  const path = usePathname();
  return (
    <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200 ring-inset" data-testid="run-box-viewer">
      <p>
        {line}{" "}
        {state === "asked" ? (
          <span className="font-medium">You asked for Member access. An admin will see it in Members.</span>
        ) : (
          <button
            type="button"
            disabled={state === "asking"}
            className="font-medium text-sky-800 underline hover:text-sky-950"
            onClick={async () => {
              setState("asking");
              const res = await askAccessFromRunBox(scope, path);
              if (!res.ok) {
                setError(res.error);
                setState("idle");
              } else setState("asked");
            }}
          >
            {state === "asking" ? "Asking…" : "Ask for Member access"}
          </button>
        )}
      </p>
      {error && <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>}
    </div>
  );
}

// "Smoke test Nov 5" (ver_187): the same date style as the rest of the app, in your own time zone, not UTC.
const today = () => new Date().toLocaleDateString(typeof document !== "undefined" && document.documentElement.lang === "en-GB" ? "en-GB" : "en-US", { month: "short", day: "numeric" });
const fieldId = (f: { id: string }) => (f.id === "csp" ? "rb-csp" : `rb-f-${f.id}`);
const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";

function Form({
  opts: loaded,
  preset,
  defaultName,
  session,
  initialRelease,
  onClose,
  onBusy,
}: {
  opts: RunBoxOptions;
  preset?: RunBoxPreset;
  defaultName?: string;
  session?: boolean;
  initialRelease?: string;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const opts = loaded;
  const router = useRouter();
  // What kind of run, asked first in an umbrella. A charter session skips it.
  const askKind = !!opts.umbrella && !session && opts.kinds.length > 0;
  const [kinds, setKinds] = useState(opts.kinds);
  // "" is a Regular run (no kind), picked for you (Monday audit: new people didn't know if
  // their test was a smoke test). Smoke test, Release candidate and your own kinds still show.
  const [kindId, setKindId] = useState<string | null>("");
  const kind = kinds.find((k) => k.id === kindId);
  // "+ New test cycle": made when you press Start, with this run in it.
  const [newCycle, setNewCycle] = useState<{ open: boolean; name: string; platform: string }>({ open: !!opts.newCycle?.empty && !!opts.newCycle.canCreate, name: "", platform: "" });
  const makingCycle = newCycle.open && !!newCycle.name.trim();
  const [pending, start] = useTransition();
  // Which Start button was pressed, and the run that's opening.
  const [pressed, setPressed] = useState<"plain" | "test" | null>(null);
  const [opening, setOpening] = useState<{ what: string; cases: number; runs: number } | null>(null);
  const busy = pending || !!opening;
  useEffect(() => onBusy(busy), [busy, onBusy]);
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  // Every box opens fresh (Scott, ver_77): nothing picked, ticked or remembered from the last run.
  const [what, setWhat] = useState<What | null>(preset?.what === "sheet" && !opts.sheetCycles.length ? null : (preset?.what ?? null));
  // From a spreadsheet (ver_177): the sheet picked here, and where it goes.
  const [sheet, setSheet] = useState<PickedSheet | null>(null);
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(() => firstSheetTarget(opts.sheetCycles, opts.hereId));
  const isSheet = what === "sheet";
  const sheetCycle = opts.sheetCycles.find((c) => c.id === sheetTarget?.cycleId);
  const sheetRun = sheetTarget?.run != null ? sheetCycle?.runs.find((r) => r.number === sheetTarget.run) : undefined;
  const [suiteId, setSuiteId] = useState(preset?.what === "suite" ? preset.suiteId : "");
  const [picked, setPicked] = useState<string[]>(preset?.what === "cases" ? preset.caseIds.filter((id) => opts.cases.some((c) => c.id === id)) : []);
  // Nothing ticked for you (Scott, ver_99), except the test cycle the box was opened from, or the
  // only test cycle there is (Scott, ver_178: one test cycle isn't a choice, and new people stopped there).
  const onlyOne = opts.cycles.length === 1 ? opts.cycles[0].id : null;
  const [cycles, setCycles] = useState<string[]>(opts.hereId && opts.cycles.some((c) => c.id === opts.hereId) ? [opts.hereId] : onlyOne ? [onlyOne] : []);
  // "Also include the automated cases": off, automation's own cases stay out of the run.
  const [withAuto, setWithAuto] = useState(false);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [priority, setPriority] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const [more, setMore] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [release, setRelease] = useState(initialRelease ?? "");
  const [build, setBuild] = useState("");
  // "Use each test cycle's own" release, when the ticked test cycles have different ones.
  const [cycleRelease, setCycleRelease] = useState(false);
  // Bumped as run fields are typed in, so the still-needed list keeps up.
  const [, setTyped] = useState(0);
  const presetName = defaultName ?? (preset?.what === "suite" ? `${opts.suites.find((s) => s.id === preset.suiteId)?.name ?? "Suite"} ${today()}` : preset?.what === "cases" ? `Picked cases ${today()}` : "");
  // The name box starts empty; the gray name is used if it's left blank.
  const [typedName, setName] = useState("");

  const suite = opts.suites.find((s) => s.id === suiteId);
  // A test cycle's own suite only runs there.
  const onlyCycle = what === "suite" && suite && !suite.shared && opts.cycles.some((c) => c.id === suite.ownerId) ? suite.ownerId : null;
  const ticked = cycles.filter((id) => !onlyCycle || id === onlyCycle);
  const chosen = opts.cycles.filter((c) => ticked.includes(c.id));
  // Each ticked test cycle's release, offered as a "Use 2.1" suggestion, never filled in.
  const rcs = [...new Set(chosen.map((c) => c.rcName.trim()).filter(Boolean))];
  // Release fills itself in from the ticked test cycle (Monday audit: blank Release left
  // Reports saying "–"). What you type yourself is never replaced.
  const oneRc = rcs.length === 1 ? rcs[0] : "";
  const [autoRelease, setAutoRelease] = useState<string | null>(null);
  useEffect(() => {
    if (release.trim() && release !== autoRelease) return;
    if (release === oneRc) return;
    setRelease(oneRc);
    setAutoRelease(oneRc || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneRc]);
  const releaseFromCycle = !!autoRelease && release === autoRelease ? chosen.find((c) => c.rcName.trim() === autoRelease) : undefined;
  const autoName = isSheet ? (sheet ? sheet.fileName.replace(/\.(csv|tsv|txt|xlsx)$/i, "") : "") : kind ? `${kind.name} ${today()}` : what === "all" ? `Full library ${today()}` : what === "suite" ? `${suite?.name ?? "Suite"} ${today()}` : what === "cases" ? `Picked cases ${today()}` : "";
  const samePick = !!preset && what === preset.what && (preset.what !== "suite" || suiteId === preset.suiteId);
  const grayName = samePick && presetName ? presetName : autoName;
  const name = typedName.trim() || grayName;

  // Forgiving search: exact matches, then close ones under their own label.
  const { visible, closeStart } = useMemo(() => {
    const inPicked = inFolder(opts.folders, folder);
    const found = forgivingFilter(
      opts.cases.filter((c) => inPicked(c) && (!tag || c.tags.includes(tag)) && (!priority || c.priority === priority)),
      q,
      (c) => `${c.key} ${c.title} ${c.tags.join(" ")}`,
    );
    return { visible: [...found.exact, ...found.close], closeStart: found.close.length ? found.exact.length : -1 };
  }, [opts, folder, tag, priority, q]);
  // Tick all takes the exact matches only, when there are some, and skips automated cases
  // unless they're included. Ticking one yourself always works.
  const isAuto = (c: { type: string }) => c.type === "AUTOMATED";
  const tickable = (closeStart > 0 ? visible.slice(0, closeStart) : visible).filter((c) => withAuto || !isAuto(c));
  const pickedSet = new Set(picked);
  // New cases: a button to tick the ones shown, and a reminder for ones left out of picked folders.
  const newShown = tickable.filter((c) => opts.news[c.id] === "new" && !pickedSet.has(c.id));
  const pickedFolders = new Set(opts.cases.filter((c) => pickedSet.has(c.id)).map((c) => c.folderId));
  const leftOut = opts.cases.filter((c) => opts.news[c.id] === "new" && !pickedSet.has(c.id) && pickedFolders.has(c.folderId) && (withAuto || !isAuto(c)));
  // Automated cases the tick box is about, for what's picked to run.
  const autoHere = what === "all" ? opts.autoCount : what === "suite" ? (suite?.autoCases ?? 0) : what === "cases" ? opts.cases.filter(isAuto).length : 0;
  // No cases anywhere the box can pick from.
  const noCases = opts.allCount === 0 && opts.cases.length === 0;
  const count =
    what === "all" ? opts.allCount + (withAuto ? opts.autoCount : 0) : what === "suite" ? (suite?.cases ?? 0) - (withAuto ? 0 : (suite?.autoCases ?? 0)) : what === "cases" ? picked.length : 0;
  const members = chosen.length === 1 ? chosen[0].members : [];
  const shownCycles = opts.cycles.filter((c) => c.current || showOlder || ticked.includes(c.id));
  const older = opts.cycles.filter((c) => !c.current && !ticked.includes(c.id)).length;

  const runCount = ticked.length + (makingCycle ? 1 : 0);
  const pickKind = (id: string) => {
    // Release candidate and Bug bash have boxes of their own.
    if (id === "rc" || id === "bash") {
      onClose();
      if (!startKind(id)) router.push(id === "rc" ? `/g/${opts.umbrella!.id}?start=rc` : `/p/${opts.umbrella!.hubKey}/bashes?bash=start`);
      return;
    }
    // A kind's usual suite is offered as "Use it" under What to run, not picked for you.
    setKindId(id);
  };
  const usual = kind?.suiteId ? opts.suites.find((x) => x.id === kind.suiteId) : undefined;
  // Required run fields still empty, for the still-needed list.
  const missingFields = opts.runFields.filter((f) => f.required && !value(fieldId(f)).trim());
  const handed = !!members.length && !!assignee && assignee !== opts.meId;
  const todo: [boolean, string][] = [
    ...(askKind ? [[kindId !== null, kind ? `Kind: ${kind.name}` : kindId === "" ? "Kind: Regular run" : "Pick what kind of run"] as [boolean, string]] : []),
    [!!what && count > 0, what === "suite" && !suite ? "Pick a suite" : what === "cases" && !count ? "Tick some cases" : what ? `${count === 1 ? "1 case" : `${count} cases`}` : "Pick what to run"],
    [
      runCount > 0,
      runCount === 0
        ? newCycle.open
          ? "Name the new test cycle"
          : "Tick a test cycle"
        : (() => {
            const where = [...chosen.map((c) => c.name), ...(makingCycle ? [`${newCycle.name.trim()} (new)`] : [])];
            return where.length > 1 ? `One run in each: ${where.join(", ")}` : `Goes in ${where[0]}`;
          })(),
    ],
    ...missingFields.map((f): [boolean, string] => [false, `Fill in ${f.name}`]),
  ];
  const sheetTodo: [boolean, string][] = [
    ...(askKind ? [todo[0]] : []),
    [!!sheet, sheet ? `${sheet.fileName}` : "Pick your sheet"],
    [!!sheetCycle, sheetRun ? `Updates ${sheetRun.title}` : sheetCycle ? `A new run in ${sheetCycle.name}` : "Pick where it goes"],
  ];
  const ready = isSheet ? sheetTodo.every(([ok]) => ok) : todo.every(([ok]) => ok);
  const nextSheet = () => {
    if (!sheet || !sheetCycle || !sheetTarget) return;
    setPressed("plain");
    handOffSheet(sheetCycle, sheet, sheetTarget, { name: name.trim() || autoName, release: release.trim(), runKind: kindId ?? "" });
  };
  const submit = (goTest: boolean) => {
    if (!what || what === "sheet") return;
    // Outside the transition, so the pressed button and the strip show straight away.
    setPressed(goTest ? "test" : "plain");
    start(async () => {
      setError(null);
      let cycleIds = ticked;
      if (makingCycle && opts.umbrella) {
        const made = await createCycleFromRunBox(opts.umbrella.id, { name: newCycle.name, platform: newCycle.platform });
        if (!made.ok) return setError(made.error);
        cycleIds = [...ticked, made.cycle.id];
      }
      const res = await startRuns({
        runKind: kindId ?? "",
        cycleIds,
        what,
        suiteId: what === "suite" ? suiteId : undefined,
        caseIds: what === "cases" ? picked : undefined,
        withAutomated: withAuto,
        name: name.trim() || autoName,
        release: release.trim(),
        cycleRelease: !release.trim() && cycleRelease,
        build: build.trim(),
        // Required fields show outside "more", so they're always sent.
        fields: Object.fromEntries(opts.runFields.filter((f) => more || f.required).map((f) => [f.id, value(fieldId(f))])),
        environment: more ? value("rb-env") : "",
        description: more ? value("rb-notes") : "",
        // With several test cycles ticked, cases start unassigned.
        assigneeId: members.length ? assignee || null : null,
      });
      if (!res.ok) return setError(res.error);
      const [first] = res.runs;
      // The box stays up with "Opening it…" until the next page shows.
      setOpening({ what: res.runs.length === 1 ? runTitle({ name: name.trim() || autoName, build }) : `${res.runs.length} ${session ? "sessions" : "runs"}`, cases: count, runs: res.runs.length });
      // Handed to someone else: land on the run page with a link to send them.
      // "Opening…" lasts until the next page replaces this one. Already on that page (a runs
      // list): it just updates, so the box goes now.
      const to = res.runs.length === 1 ? `/p/${first.key}/runs/${first.number}${goTest ? "/execute" : handed ? `?handed=${assignee}` : ""}` : opts.umbrella ? `/g/${opts.umbrella.id}/runs` : `/p/${first.key}/runs`;
      // The runner loads fresh: its address redirects to pick a case, and a refresh sent alongside
      // a soft push could land after that and leave it blank, about 1 in 3 (ver156 e2e). Other pages
      // keep the refresh: without it, later refreshes and Save and next on the new page were
      // ignored (ver_108 e2e: run-edit, history, long-text).
      if (to.endsWith("/execute")) return window.location.assign(to);
      router.refresh();
      router.push(to);
      if (to === pathname) onClose();
    });
  };

  const choice = (w: What, title: string, sub: string) => (
    <button
      type="button"
      aria-pressed={what === w}
      data-howto={w === "sheet" ? "run-sheet" : undefined}
      onClick={() => setWhat(w)}
      className={cx("rounded-md border px-3 py-2 text-left", what === w ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-slate-200 hover:bg-slate-50")}
    >
      <span className="block text-sm font-medium text-slate-900">{title}</span>
      <span className="block truncate text-xs text-slate-500">{sub}</span>
    </button>
  );

  // Steps are numbered from the kind question when it's asked.
  const step = (n: number) => n + (askKind ? 1 : 0);
  // No cases yet: said up front (ver_178), before the kind question, then again under What to run.
  const noCasesNote = (
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="run-no-cases">
            <p>There are no test cases here yet, so there&apos;s nothing to run.</p>
            {(opts.canCases || opts.canImport) && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {opts.canCases && (
                  <a href={`/p/${opts.libraryKey}/cases/new`} target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
                    Write the first case ↗
                  </a>
                )}
                {opts.canImport && (
                  <a href={`/p/${opts.libraryKey}/import`} target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
                    Import cases ↗
                  </a>
                )}
              </p>
            )}
          </div>
  );
  return (
    <div className="space-y-4" onInput={() => setTyped((t) => t + 1)}>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {/* Your spinner from the moment you press Start, then "Opening it…". */}
      {(opening || (pending && pressed)) && (
        <BusyStrip testId={opening ? "run-opening" : "run-making"}>
          {opening ? <OpeningRun {...opening} session={session} /> : <MakingRun what={name.trim() || autoName} cases={count} runs={Math.max(1, chosen.length + (makingCycle ? 1 : 0))} session={session} />}
        </BusyStrip>
      )}
      <div inert={busy} className={cx("space-y-4", busy && "opacity-50")}>
      {askKind && kindId === null && noCases && noCasesNote}
      {askKind && (
        <KindStep
          kinds={kinds}
          picked={kindId}
          suites={opts.suites}
          canRc={opts.canRc}
          lastCycle={opts.lastCycle}
          groupId={opts.umbrella!.id}
          onPick={pickKind}
          onAdded={(k) => {
            setKinds((l) => [...l, k]);
            pickKind(k.id);
          }}
          onChange={() => setKindId(null)}
        />
      )}
      {kindId !== null && (
      <>
      <section aria-labelledby="rb-what" data-howto="run-what">
        <h3 id="rb-what" className="mb-1.5 text-xs font-semibold text-slate-600">
          {step(1)}. What to run
        </h3>
        {usual && !(what === "suite" && suiteId === usual.id) && (
          <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900" data-testid="usual-suite">
            <span>
              {kind!.name} usually runs <b>{usual.name}</b> ({usual.cases} {usual.cases === 1 ? "case" : "cases"}).
            </span>
            <Button
              size="sm"
              onClick={() => {
                setWhat("suite");
                setSuiteId(usual.id);
              }}
            >
              Use it
            </Button>
          </p>
        )}
        {noCases ? (
          // Nothing to run yet: one note instead of "All 0 active cases".
          noCasesNote
        ) : (
          <div className={cx("grid gap-2", opts.sheetCycles.length ? "sm:grid-cols-2 md:grid-cols-4" : "sm:grid-cols-3")}>
            {choice("all", opts.umbrella ? "Whole Case library" : "Every case", opts.autoCount ? `${opts.allCount} ${opts.allCount === 1 ? "case" : "cases"} you test by hand` : `All ${opts.allCount} active cases`)}
            {choice("suite", "A suite", opts.suites.length ? opts.suites.map((s) => s.name).join(", ") : "None yet")}
            {choice("cases", "Pick cases", "Search and tick")}
            {opts.sheetCycles.length > 0 && choice("sheet", "From a spreadsheet", "A run you already started in a sheet")}
          </div>
        )}
      </section>

      {what && autoHere > 0 && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="with-auto">
          <input type="checkbox" className="mt-1" checked={withAuto} onChange={(e) => setWithAuto(e.target.checked)} />
          <span className="min-w-0">
            Also include the {autoHere === 1 ? "automated case" : `${autoHere} automated cases`} <AutomatedBadge tip="Made from automation results. Automation already runs these." />
            <span className="block text-xs text-slate-500">
              Your automation already runs {autoHere === 1 ? "it" : "these"} and sends the results in. Tick this only if someone will check {autoHere === 1 ? "it" : "them"} by hand too.
              {what === "cases" && !withAuto && " Tick all skips them; a case you tick yourself still goes in."}
            </span>
          </span>
        </label>
      )}

      {isSheet && <SheetPick projectId={sheetCycle?.id ?? opts.sheetCycles[0].id} sheet={sheet} onSheet={setSheet} />}
      {what === "all" && <p className="text-xs text-slate-500">Every active case as it is now. Cases added later aren&apos;t in this run.</p>}

      {what === "suite" &&
        (opts.suites.length ? (
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" aria-label="Suites">
            {opts.suites.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="radio" name="rb-suite" checked={suiteId === s.id} onChange={() => setSuiteId(s.id)} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{s.name}</span>
                  <span className="text-xs text-slate-500">
                    {s.cases} {s.cases === 1 ? "case" : "cases"}
                    {s.autoCases > 0 && !withAuto ? ` · ${s.autoCases} automated left out` : ""}
                    {opts.umbrella && !s.shared ? " · this test cycle only" : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="run-no-suites">
            <p>There are no suites yet. A suite is a saved list of cases you can run again and again. For now, run the whole library or pick cases.</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Button size="sm" onClick={() => setWhat("cases")}>
                Pick cases instead
              </Button>
              {opts.canSuites && (
                <>
                  <a href={`/p/${opts.libraryKey}/suites/new`} target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
                    Make a suite ↗
                  </a>
                  <span className="text-xs text-sky-800">opens a new tab</span>
                </>
              )}
            </p>
          </div>
        ))}

      {what === "cases" && (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 p-2">
            <Input className="h-8 min-w-32 flex-1" placeholder="Search title or key" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
            {opts.tags.length > 0 && (
              <Select className="h-8 w-auto" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
                <option value="">Any tag</option>
                {opts.tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
            <Select className="h-8 w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
            {/* Option B of the Tick all mockup: a real button by the filters, not a footer link. */}
            {(() => {
              const allOn = tickable.length > 0 && tickable.every((c) => pickedSet.has(c.id));
              const ids = new Set(tickable.map((c) => c.id));
              return (
                <Button
                  size="sm"
                  className="h-8 border-accent-500 text-accent-700 hover:bg-accent-50"
                  disabled={!tickable.length}
                  onClick={() => setPicked((p) => (allOn ? p.filter((id) => !ids.has(id)) : [...new Set([...p, ...ids])]))}
                >
                  {allOn ? "Untick all" : `Tick all ${tickable.length}`}
                </Button>
              );
            })()}
            {newShown.length > 0 && (
              <Button size="sm" className="h-8 border-sky-300 text-sky-800 hover:bg-sky-50" onClick={() => setPicked((p) => [...new Set([...p, ...newShown.map((c) => c.id)])])}>
                Tick the {newShown.length} new {newShown.length === 1 ? "case" : "cases"}
              </Button>
            )}
          </div>
          {opts.folders.length > 0 && (
            <p className="border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500" data-testid="pick-hint">
              Pick a folder, then tick the cases this run tests.
            </p>
          )}
          <div className={cx("grid", opts.folders.length > 0 && "sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]")}>
          {opts.folders.length > 0 && (
            <div className="border-b border-slate-200 sm:border-r sm:border-b-0">
              <FolderList folders={opts.folders} cases={opts.cases} value={folder} onChange={setFolder} />
            </div>
          )}
          <ul className="max-h-72 min-w-0 divide-y divide-slate-100 overflow-y-auto" aria-label="Cases to pick">
            {visible.slice(0, 300).map((c, i) => (
              <li key={c.id}>
                {i === closeStart && (
                  <>
                    {closeStart === 0 && <p className="px-3 pt-1.5 text-xs text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel />
                  </>
                )}
                <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="mt-1" checked={pickedSet.has(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-slate-500">{c.key}</span> <TagPills tags={c.tags} colors={opts.tagColors} hits={tagHits(q, c.tags)} /> {c.title}
                    {opts.news[c.id] && <NewsTag kind={opts.news[c.id]} className="ml-1" title={opts.news[c.id] === "new" ? "Never run before" : "Steps changed since its last run"} />}
                    {isAuto(c) && (
                      <span className="ml-1 align-middle">
                        <AutomatedBadge tip="Made from automation results. Automation already runs this case." />
                      </span>
                    )}
                    {c.folderPath && <span className="text-xs text-slate-500"> · {c.folderPath}</span>}
                  </span>
                </label>
              </li>
            ))}
            {visible.length > 300 && <li className="px-3 py-2 text-xs text-slate-500">Showing 300 of {visible.length}. Search or pick a folder to narrow it down.</li>}
            {visible.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-slate-500">
                {tag || priority ? (
                  <>
                    No cases here match the tag or priority filter.{" "}
                    <button
                      type="button"
                      className="font-medium text-accent-700 underline"
                      onClick={() => {
                        setTag("");
                        setPriority("");
                      }}
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  "No cases match."
                )}
              </li>
            )}
          </ul>
          </div>
          <CantFindCase archived={opts.archived} bracketTitles={opts.bracketTitles} umbrellaName={opts.umbrellaName} libraryKey={opts.libraryKey} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <span>
              {picked.length} picked
              {leftOut.length > 0 && (
                <span className="ml-2 text-sky-800" data-testid="new-left-out">
                  · {leftOut.length} new {leftOut.length === 1 ? "case" : "cases"} in the same {pickedFolders.size === 1 ? "folder" : "folders"} {leftOut.length === 1 ? "is" : "are"} not ticked.{" "}
                  <button type="button" className="font-medium underline hover:no-underline" onClick={() => setPicked((p) => [...new Set([...p, ...leftOut.map((c) => c.id)])])}>
                    Tick {leftOut.length === 1 ? "it" : "them"}
                  </button>
                </span>
              )}
            </span>
            {picked.length > 0 && (
              <button type="button" className="hover:underline" onClick={() => setPicked([])}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {isSheet ? (
        <section aria-labelledby="rb-sheet-where">
          <h3 id="rb-sheet-where" className="mb-1.5 text-xs font-semibold text-slate-600">
            {step(2)}. Where it goes
          </h3>
          <SheetWhere cycles={opts.sheetCycles} value={sheetTarget} onChange={setSheetTarget} />
        </section>
      ) : (
      <section aria-labelledby="rb-where" data-howto="run-where">
        <h3 id="rb-where" className="mb-1.5 text-xs font-semibold text-slate-600">
          {step(2)}. Test cycle <span className="font-normal text-slate-500">· Where the chosen test cases will go</span>
        </h3>
        {opts.newCycle?.empty && !newCycle.open && (
          <p className="mb-2 text-sm text-slate-600">
            {opts.umbrella?.name} has no test cycles yet. {opts.newCycle.canCreate ? "Make the first one here." : "Ask an admin to add one, then start the run."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {shownCycles.map((c) => {
            const off = !!onlyCycle && c.id !== onlyCycle;
            return (
              <label key={c.id} className={cx("flex items-center gap-1.5 rounded-full border border-slate-200 py-1 pr-3 pl-2 text-sm", off ? "opacity-50" : "cursor-pointer hover:bg-slate-50")}>
                <input type="checkbox" disabled={off} checked={ticked.includes(c.id)} onChange={() => setCycles((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} />
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </label>
            );
          })}
          {older > 0 && !showOlder && (
            <button type="button" className="text-sm text-accent-700 hover:underline" onClick={() => setShowOlder(true)}>
              Older test cycles ({older})
            </button>
          )}
          {opts.newCycle?.canCreate && !onlyCycle && (
            <button
              type="button"
              aria-expanded={newCycle.open}
              onClick={() => setNewCycle((n) => ({ ...n, open: !n.open }))}
              className={cx("rounded-full border border-dashed px-3 py-1 text-sm", newCycle.open ? "border-accent-500 bg-accent-50 text-accent-700" : "border-slate-300 text-slate-700 hover:bg-slate-50")}
            >
              ＋ New test cycle
            </button>
          )}
        </div>
        {newCycle.open && opts.newCycle?.canCreate && (
          <div className="mt-2 grid gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-2" data-testid="new-cycle">
            <Field label="Name" htmlFor="rb-cycle-name">
              <Input id="rb-cycle-name" value={newCycle.name} onChange={(e) => setNewCycle((n) => ({ ...n, name: e.target.value }))} placeholder="e.g. Sprint 14 smoke" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Platform (optional)" htmlFor="rb-cycle-platform">
                <PlatformPicker id="rb-cycle-platform" platforms={opts.newCycle.platforms} umbrella={opts.umbrella?.name ?? "the umbrella"} value={newCycle.platform} onChange={(platform) => setNewCycle((n) => ({ ...n, platform }))} />
              </Field>
            </div>
            <p className="flex items-center gap-1 text-xs text-slate-500 sm:col-span-2">
              Made when you press Create, with this run in it.
              <InfoTip text={`A test cycle is the folder a run goes in, like "Sprint 14". It uses ${opts.umbrella?.name}'s cases, Jira, bug template and team.`} />
            </p>
          </div>
        )}
      </section>
      )}

      {isSheet ? (
        sheetTarget?.run == null && (
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label="Run name (optional)" htmlFor="rb-name" hint={grayName ? "Leave it blank to use the sheet's name." : undefined}>
              <Input id="rb-name" value={typedName} onChange={(e) => setName(e.target.value)} placeholder={grayName || "Pick your sheet first"} />
            </Field>
            <Field label="Release (optional)" htmlFor="rb-release">
              <Input id="rb-release" aria-label="Release" value={release} onChange={(e) => setRelease(e.target.value)} placeholder="e.g. 2.1" />
            </Field>
          </div>
        )
      ) : (
      <>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field label="Run name (optional)" htmlFor="rb-name" hint={grayName ? "Leave it blank to use the suggested name shown." : undefined}>
          <Input id="rb-name" data-howto="run-name" value={typedName} onChange={(e) => setName(e.target.value)} placeholder={grayName || "Pick what to run first"} />
        </Field>
        <Field
          label="Release (optional)"
          htmlFor="rb-release"
          hint={
            !release.trim() && rcs.length > 0 && !(rcs.length > 1 && cycleRelease) ? (
              <span className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900" data-testid="release-suggest">
                {rcs.length === 1 ? (
                  <>
                    <span>
                      {chosen.find((c) => c.rcName.trim() === rcs[0])!.name} is release {rcs[0]}.
                    </span>
                    <Button size="sm" onClick={() => setRelease(rcs[0])}>
                      Use {rcs[0]}
                    </Button>
                  </>
                ) : (
                  <>
                    <span>These test cycles have releases {rcs.join(", ")}.</span>
                    <Button size="sm" onClick={() => setCycleRelease(true)}>
                      Use each one&apos;s own
                    </Button>
                  </>
                )}
              </span>
            ) : !release.trim() && cycleRelease && rcs.length > 1 ? (
              <span>
                Each run gets its test cycle&apos;s release.{" "}
                <button type="button" className="text-accent-700 underline" onClick={() => setCycleRelease(false)}>
                  Undo
                </button>
              </span>
            ) : releaseFromCycle ? (
              <span data-testid="release-from-cycle">From {releaseFromCycle.name}. Change it if this run tests something else.</span>
            ) : release.trim() ? (
              <span data-testid="release-counts">Counts toward {release.trim()} on Release status. Leave it blank to keep this run out.</span>
            ) : undefined
          }
        >
          <Input id="rb-release" aria-label="Release" value={release} onChange={(e) => setRelease(e.target.value)} placeholder="e.g. 2.1" />
        </Field>
        {/* Version up front (ver_189): it's how every list names the run, in place of "R1". */}
        <Field label="Version (optional)" htmlFor="rb-build" hint="The build you're testing. Runs show it instead of a run number.">
          <Input id="rb-build" aria-label="Version" data-howto="run-version" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="e.g. 2.4.2 (812)" maxLength={120} />
        </Field>
        <RunFieldInputs fields={opts.runFields.filter((f) => f.required)} prefix="rb" />
      </div>

      <div>
        <button type="button" className="text-xs text-slate-600 hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "▾" : "▸"} More details (optional): {[...opts.runFields.filter((f) => !f.required).map((f) => (f.id === "csp" ? "CSP" : f.name)), "environment, assign to, notes"].join(", ")}
        </button>
        {more && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <RunFieldInputs fields={opts.runFields.filter((f) => !f.required)} prefix="rb" />
            <Field label="Environment" htmlFor="rb-env">
              <Input id="rb-env" placeholder="Where you're testing" />
            </Field>
            <Field label="Assign every case to" htmlFor="rb-assignee" hint={members.length ? "Or leave it and share cases out on the run page: tick cases, then Assign selected to…" : "Cases start unassigned. Share them out on each run page: tick cases, then Assign selected to…"}>
              <Select
                id="rb-assignee"
                value={members.length ? assignee : ""}
                disabled={!members.length}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Nobody yet</option>
                <option value={opts.meId}>Me</option>
                {members
                  .filter((m) => m.id !== opts.meId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes" htmlFor="rb-notes">
                <Textarea id="rb-notes" rows={2} />
              </Field>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      </>
      )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        {/* What's still needed, so it's clear why Start is grayed out. */}
        <ul className="space-y-0.5 text-xs" aria-live="polite" data-testid="run-todo">
          {(isSheet ? sheetTodo : todo).map(([ok, text]) => (
            <li key={text} className={ok ? "text-slate-700" : "text-slate-500"}>
              <span className={cx("mr-1", ok ? "text-emerald-600" : "text-slate-400")} aria-hidden>
                {ok ? "✓" : "○"}
              </span>
              {text}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {kindId !== null &&
            (isSheet ? (
              <Button variant="primary" disabled={busy || pressed !== null || !ready} onClick={nextSheet} data-howto="run-sheet-next">
                {pressed ? "Opening…" : "Next: check the sheet"}
              </Button>
            ) : runCount > 1 ? (
              <Button variant="primary" disabled={busy || !ready} onClick={() => submit(false)} data-howto={session ? undefined : "run-go"}>
                {busy ? <Working opening={!!opening} session={session} /> : session ? `Start ${runCount} sessions` : `Create ${runCount} runs`}
              </Button>
            ) : session ? (
              <Button variant="primary" disabled={busy || !ready} onClick={() => submit(true)}>
                {busy ? <Working opening={!!opening} session={session} /> : "Start session"}
              </Button>
            ) : (
              <>
                <Button disabled={busy || !ready} onClick={() => submit(false)} data-howto={handed ? "run-go" : undefined}>
                  {busy && pressed === "plain" ? <Working opening={!!opening} session={session} /> : kind ? `Create ${kind.name.toLowerCase()}` : "Create run"}
                </Button>
                {/* Handing every case to someone else: no "test now" for you. */}
                {!handed && (
                  <Button variant="primary" disabled={busy || !ready} onClick={() => submit(true)} data-howto="run-go">
                    {busy && pressed === "test" ? <Working opening={!!opening} session={session} /> : "Create and test now"}
                  </Button>
                )}
              </>
            ))}
        </div>
      </div>
    </div>
  );
}

/** A pressed Start button: a small plain ring and what's happening. */
function Working({ opening, session }: { opening: boolean; session?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SpinnerArt id="ring" size={14} />
      {opening ? "Opening…" : session ? "Starting…" : "Creating…"}
    </span>
  );
}

/** "Making Web smoke…", while Flaw Patrol makes the run. */
function MakingRun({ what, cases, runs, session }: { what: string; cases: number; runs: number; session?: boolean }) {
  const one = runs === 1;
  return (
    <>
      <p>
        <b>{one ? `Making ${what}…` : `Making ${runs} ${session ? "sessions" : "runs"}…`}</b>
      </p>
      <p className="text-xs text-slate-600">
        Adding {cases === 1 ? "1 case" : `${cases} cases`}
        {one ? "" : " to each"}
      </p>
    </>
  );
}

/** "R14 Web smoke is ready. Opening it…", up until the run page shows. */
function OpeningRun({ what, cases, runs, session }: { what: string; cases: number; runs: number; session?: boolean }) {
  const one = runs === 1;
  return (
    <>
      <p>
        {one ? (
          <>
            <b>{what}</b> is ready. Opening it…
          </>
        ) : (
          <>
            Started <b>{what}</b>. Opening {session ? "them" : "Test runs"}…
          </>
        )}
      </p>
      <p className="text-xs text-slate-600">
        <span className="text-emerald-600" aria-hidden>
          ✓
        </span>{" "}
        Made {one ? "the run" : "each run"} with {cases === 1 ? "1 case" : `${cases} cases`}
      </p>
    </>
  );
}

type Kind = RunBoxOptions["kinds"][number];
/** A run with no kind: the first tile, picked for you. */
const REGULAR: Kind = { id: "", name: "Regular run", suiteId: null, builtIn: true };

/**
 * "What kind of run?": Smoke test, Release candidate, the umbrella's own kinds,
 * Bug bash and "+ New kind…". A kind's usual suite is offered under What to run.
 */
function KindStep({
  kinds,
  picked,
  suites,
  canRc,
  lastCycle,
  groupId,
  onPick,
  onAdded,
  onChange,
}: {
  kinds: Kind[];
  picked: string | null;
  suites: RunBoxOptions["suites"];
  canRc: boolean;
  lastCycle: string;
  groupId: string;
  onPick: (id: string) => void;
  onAdded: (k: Kind) => void;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const usual = (k: Kind) => {
    const s = suites.find((x) => x.id === k.suiteId);
    return s ? `Usually runs ${s.name} · ${s.cases} ${s.cases === 1 ? "case" : "cases"}` : "";
  };
  const sub = (k: Kind) =>
    k.id === "rc"
      ? `One test cycle per platform${lastCycle ? `, carries over from ${lastCycle}` : ""}`
      : k.id === "bash"
        ? "Everyone tests freely and files bugs live"
        : k.id === ""
          ? "Test the cases you pick"
          : usual(k) || (k.builtIn ? "A quick check that the basics work" : "Your own kind of run");
  const shown = [REGULAR, ...kinds.filter((k) => k.id !== "rc" || canRc)];
  const chosen = kinds.find((k) => k.id === picked);
  if (chosen && picked !== "")
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700" data-testid="kind-picked">
        <span className="text-xs font-semibold text-slate-600">Kind of run</span>
        <span className="rounded-full bg-accent-50 px-2.5 py-0.5 font-medium text-accent-700">{chosen.name}</span>
        <button type="button" className="text-xs text-accent-700 hover:underline" onClick={onChange}>
          Change
        </button>
      </p>
    );
  const add = () =>
    start(async () => {
      setError(null);
      const res = await addRunKind(groupId, { name, suiteId: suiteId || null });
      if (!res.ok) return setError(res.error);
      onAdded(res.kind);
    });
  return (
    <section aria-labelledby="rb-kind">
      <h3 id="rb-kind" className="mb-1.5 text-xs font-semibold text-slate-600">
        1. What kind of run?
      </h3>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Kind of run" data-howto="run-kind">
        {shown.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => onPick(k.id)}
            aria-pressed={k.id === picked}
            // Release candidate and Bug bash start getting their boxes ready before the click.
            {...(k.id === "rc" || k.id === "bash" ? prefetchOn(() => startPrefetch(k.id as "rc" | "bash")) : {})}
            className={cx(
              "rounded-md border px-3 py-2 text-left",
              k.id === picked ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-slate-200 hover:border-accent-500 hover:bg-slate-50",
            )}>
            <span className="block text-sm font-medium text-slate-900">
              {k.id === "bash" && <span aria-hidden>🐞 </span>}
              {k.name}
            </span>
            <span className="block truncate text-xs text-slate-500">{sub(k)}</span>
          </button>
        ))}
        <button
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
          className={cx("rounded-md border border-dashed px-3 py-2 text-left", adding ? "border-accent-500 bg-accent-50" : "border-slate-300 hover:bg-slate-50")}
        >
          <span className="block text-sm font-medium text-slate-900">＋ New kind…</span>
          <span className="block text-xs text-slate-500">Name it and pick its usual suite</span>
        </button>
      </div>
      {adding && (
        <div className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" data-testid="new-kind">
          <Field label="Name" htmlFor="rb-kind-name">
            <Input id="rb-kind-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Regression" autoFocus />
          </Field>
          <Field label="Usual suite (optional)" htmlFor="rb-kind-suite">
            {suites.some((s) => s.shared) ? (
              <Select id="rb-kind-suite" value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
                <option value="">None</option>
                {suites
                  .filter((s) => s.shared)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            ) : (
              // No suites yet: a plain line instead of a list with only None.
              <p id="rb-kind-suite" className="flex h-9 items-center text-sm text-slate-500" data-testid="no-suites-optional">
                No suites yet. That&apos;s fine, it&apos;s optional.
              </p>
            )}
          </Field>
          <Button variant="primary" disabled={pending || !name.trim()} onClick={add}>
            {pending ? "Adding…" : "Add and use it"}
          </Button>
          <div className="sm:col-span-3">
            <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          </div>
        </div>
      )}
    </section>
  );
}
