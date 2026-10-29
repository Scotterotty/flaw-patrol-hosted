"use client";

import { TagPills } from "./tag-pill";
import { forgivingFilter, tagHits } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/format";
import { startKind } from "@/lib/start-kind";
import { addRunKind, createCycleFromRunBox, runBoxOptions, startRuns, type RunBoxOptions, type RunBoxScope } from "@/server/start-run";
import { Modal } from "./modal";
import { RunFieldInputs } from "./run-field-inputs";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select, Textarea } from "./ui";

type What = "all" | "suite" | "cases";
export type RunBoxPreset = { what: "all" } | { what: "suite"; suiteId: string } | { what: "cases"; caseIds: string[] };

/**
 * "Start a run" (ver_76): one box everywhere. Pick what to run from the library
 * (all of it, a suite, or ticked cases), then the test cycles to run it in.
 * The box loads its choices when it opens.
 */
export function StartRunBox({
  scope,
  preset,
  label = "Start a run",
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
  /** An exploratory charter: the box says "Start session" (ver_89). */
  session?: boolean;
  /** Opens by itself when the page link has ?start=<this> (ver_95: the setup card's Start a run). */
  openParam?: string;
}) {
  const [open, setOpen] = useState(initialOpen && !disabled);
  const asked = useSearchParams().get("start");
  useEffect(() => {
    if (openParam && asked === openParam && !disabled) setOpen(true);
  }, [asked, openParam, disabled]);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={session ? "Start a session" : "Start a run"} wide>
        <Box scope={scope} preset={preset} defaultName={defaultName} session={session} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function Box({ scope, preset, defaultName, session, onClose }: { scope: RunBoxScope; preset?: RunBoxPreset; defaultName?: string; session?: boolean; onClose: () => void }) {
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
        {error ? <ErrorText>{error}</ErrorText> : <p className="py-6 text-center text-sm text-slate-500">Loading the library…</p>}
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  return <Form opts={opts} preset={preset} defaultName={defaultName} session={session} onClose={onClose} />;
}

const today = () => new Date().toISOString().slice(0, 10);
const fieldId = (f: { id: string }) => (f.id === "csp" ? "rb-csp" : `rb-f-${f.id}`);
const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";

function Form({ opts: loaded, preset, defaultName, session, onClose }: { opts: RunBoxOptions; preset?: RunBoxPreset; defaultName?: string; session?: boolean; onClose: () => void }) {
  const opts = loaded;
  const router = useRouter();
  // What kind of run (ver_95), asked first in an umbrella. A charter session skips it.
  const askKind = !!opts.umbrella && !session && opts.kinds.length > 0;
  const [kinds, setKinds] = useState(opts.kinds);
  const [kindId, setKindId] = useState<string | null>(askKind ? null : "");
  const kind = kinds.find((k) => k.id === kindId);
  // "+ New test cycle" (ver_95): made when you press Start, with this run in it.
  const [newCycle, setNewCycle] = useState<{ open: boolean; name: string; platform: string }>({ open: !!opts.newCycle?.empty && !!opts.newCycle.canCreate, name: "", platform: "" });
  const makingCycle = newCycle.open && !!newCycle.name.trim();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Every box opens fresh (Scott, ver_77): nothing picked, ticked or remembered from the last run.
  const [what, setWhat] = useState<What | null>(preset?.what ?? null);
  const [suiteId, setSuiteId] = useState(preset?.what === "suite" ? preset.suiteId : "");
  const [picked, setPicked] = useState<string[]>(preset?.what === "cases" ? preset.caseIds.filter((id) => opts.cases.some((c) => c.id === id)) : []);
  // Ticked for you when there's no choice to make, or when the box opened inside a test cycle (ver_85).
  const [cycles, setCycles] = useState<string[]>(
    opts.hereId && opts.cycles.some((c) => c.id === opts.hereId) ? [opts.hereId] : opts.newestId ? [opts.newestId] : opts.cycles.length === 1 ? [opts.cycles[0].id] : [],
  );
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [priority, setPriority] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const [more, setMore] = useState(false);
  const [goTest, setGoTest] = useState(true);
  const [assignee, setAssignee] = useState("");
  const [release, setRelease] = useState<string | null>(null);
  const [name, setName] = useState(
    defaultName ?? (preset?.what === "suite" ? `${opts.suites.find((s) => s.id === preset.suiteId)?.name ?? "Suite"} ${today()}` : preset?.what === "cases" ? `Picked cases ${today()}` : ""),
  );

  const suite = opts.suites.find((s) => s.id === suiteId);
  // A test cycle's own suite only runs there.
  const onlyCycle = what === "suite" && suite && !suite.shared && opts.cycles.some((c) => c.id === suite.ownerId) ? suite.ownerId : null;
  const ticked = cycles.filter((id) => !onlyCycle || id === onlyCycle);
  const chosen = opts.cycles.filter((c) => ticked.includes(c.id));
  const rcs = [...new Set(chosen.map((c) => c.rcName))];
  const releaseValue = release ?? (rcs.length === 1 ? rcs[0] : "");
  const autoName = kind ? `${kind.name} ${today()}` : what === "all" ? `Full library ${today()}` : what === "suite" ? `${suite?.name ?? "Suite"} ${today()}` : what === "cases" ? `Picked cases ${today()}` : "";

  // Forgiving search (ver_96): exact matches, then close ones under their own label.
  const { visible, closeStart } = useMemo(() => {
    const folderIds = folder ? new Set(opts.folders.find((f) => f.id === folder)?.ids ?? []) : null;
    const found = forgivingFilter(
      opts.cases.filter((c) => (!folderIds || (c.folderId && folderIds.has(c.folderId))) && (!tag || c.tags.includes(tag)) && (!priority || c.priority === priority)),
      q,
      (c) => `${c.key} ${c.title} ${c.tags.join(" ")}`,
    );
    return { visible: [...found.exact, ...found.close], closeStart: found.close.length ? found.exact.length : -1 };
  }, [opts, folder, tag, priority, q]);
  // Tick all takes the exact matches only, when there are some.
  const tickable = closeStart > 0 ? visible.slice(0, closeStart) : visible;
  const pickedSet = new Set(picked);
  const count = what === "all" ? opts.allCount : what === "suite" ? (suite?.cases ?? 0) : what === "cases" ? picked.length : 0;
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
    setKindId(id);
    // A kind's usual suite fills in what to run, unless something was already picked.
    const k = kinds.find((x) => x.id === id);
    if (k?.suiteId && !preset && opts.suites.some((x) => x.id === k.suiteId)) {
      setWhat("suite");
      setSuiteId(k.suiteId);
    }
  };
  const submit = () =>
    what &&
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
        name: name.trim() || autoName,
        release: releaseValue,
        build: more ? value("rb-build") : "",
        // Required fields show outside "more", so they're always sent.
        fields: Object.fromEntries(opts.runFields.filter((f) => more || f.required).map((f) => [f.id, value(fieldId(f))])),
        environment: more ? value("rb-env") : "",
        description: more ? value("rb-notes") : "",
        // With several test cycles ticked, cases start unassigned.
        assigneeId: members.length ? assignee || null : null,
      });
      if (!res.ok) return setError(res.error);
      onClose();
      const [first] = res.runs;
      router.refresh();
      // Handed to someone else (ver_85): land on the run page with a link to send them.
      const handed = members.length && assignee && assignee !== opts.meId ? `?handed=${assignee}` : "";
      if (res.runs.length === 1) router.push(`/p/${first.key}/runs/${first.number}${goTest ? "/execute" : handed}`);
      else router.push(opts.umbrella ? `/g/${opts.umbrella.id}/runs` : `/p/${first.key}/runs`);
    });

  const choice = (w: What, title: string, sub: string) => (
    <button
      type="button"
      aria-pressed={what === w}
      onClick={() => setWhat(w)}
      className={cx("rounded-md border px-3 py-2 text-left", what === w ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-slate-200 hover:bg-slate-50")}
    >
      <span className="block text-sm font-medium text-slate-900">{title}</span>
      <span className="block truncate text-xs text-slate-500">{sub}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
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
      <section aria-labelledby="rb-what">
        <h3 id="rb-what" className="mb-1.5 text-xs font-semibold text-slate-600">
          1. What to run
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {choice("all", opts.umbrella ? "Whole Case library" : "Every case", `All ${opts.allCount} active cases`)}
          {choice("suite", "A suite", opts.suites.length ? opts.suites.map((s) => s.name).join(", ") : "No suites yet")}
          {choice("cases", "Pick cases", "Search and tick")}
        </div>
      </section>

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
                    {opts.umbrella && !s.shared ? " · this test cycle only" : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">No suites yet. Pick cases instead, or make a suite in Test suites.</p>
        ))}

      {what === "cases" && (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 p-2">
            <Input className="h-8 min-w-32 flex-1" placeholder="Search title or key" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
            {opts.folders.length > 0 && (
              <Select className="h-8 w-auto max-w-48" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder">
                <option value="">All folders</option>
                {opts.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
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
            {/* Option B of the Tick all mockup (ver_93): a real button by the filters, not a footer link. */}
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
          </div>
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto" aria-label="Cases to pick">
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
                    {c.folderPath && <span className="text-xs text-slate-500"> · {c.folderPath}</span>}
                  </span>
                </label>
              </li>
            ))}
            {visible.length > 300 && <li className="px-3 py-2 text-xs text-slate-500">Showing 300 of {visible.length}. Search or pick a folder to narrow it down.</li>}
            {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No cases match.</li>}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <span>{picked.length} picked</span>
            {picked.length > 0 && (
              <button type="button" className="hover:underline" onClick={() => setPicked([])}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <section aria-labelledby="rb-where">
        <h3 id="rb-where" className="mb-1.5 text-xs font-semibold text-slate-600">
          2. Where it goes <span className="font-normal text-slate-500">· one run in each test cycle you tick</span>
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
          <div className="mt-2 grid gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-[1fr_12rem]" data-testid="new-cycle">
            <Field label="Name" htmlFor="rb-cycle-name">
              <Input id="rb-cycle-name" value={newCycle.name} onChange={(e) => setNewCycle((n) => ({ ...n, name: e.target.value }))} placeholder="e.g. Sprint 14 smoke" />
            </Field>
            <Field label="Platform (optional)" htmlFor="rb-cycle-platform">
              <Input id="rb-cycle-platform" list="rb-cycle-platforms" value={newCycle.platform} onChange={(e) => setNewCycle((n) => ({ ...n, platform: e.target.value }))} />
              <datalist id="rb-cycle-platforms">
                {opts.newCycle.platforms.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <p className="flex items-center gap-1 text-xs text-slate-500 sm:col-span-2">
              Made when you press Start, with this run in it.
              <InfoTip text={`A test cycle is the folder a run goes in, like "Sprint 14". It uses ${opts.umbrella?.name}'s cases, Jira, bug template and team.`} />
            </p>
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Run name" htmlFor="rb-name">
          <Input id="rb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} />
        </Field>
        <Field label="Release (optional)" htmlFor="rb-release" hint={rcs.length > 1 && release === null ? "Blank uses each test cycle's own." : undefined}>
          <Input id="rb-release" aria-label="Release" value={releaseValue} onChange={(e) => setRelease(e.target.value)} placeholder="e.g. 2.1" />
        </Field>
        <RunFieldInputs fields={opts.runFields.filter((f) => f.required)} prefix="rb" />
      </div>

      <div>
        <button type="button" className="text-xs text-slate-600 hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "▾" : "▸"} {["Build", ...opts.runFields.filter((f) => !f.required).map((f) => (f.id === "csp" ? "CSP" : f.name)), "environment, assign to, notes"].join(", ")}
        </button>
        {more && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Build" htmlFor="rb-build">
              <Input id="rb-build" placeholder="The build you're testing" />
            </Field>
            <RunFieldInputs fields={opts.runFields.filter((f) => !f.required)} prefix="rb" />
            <Field label="Environment" htmlFor="rb-env">
              <Input id="rb-env" placeholder="Where you're testing" />
            </Field>
            <Field label="Assign every case to" htmlFor="rb-assignee" hint={members.length ? "Or leave it and share cases out on the run page: tick cases, then Assign selected to…" : "Cases start unassigned. Share them out on each run page: tick cases, then Assign selected to…"}>
              <Select
                id="rb-assignee"
                value={members.length ? assignee : ""}
                disabled={!members.length}
                onChange={(e) => {
                  setAssignee(e.target.value);
                  // Every case going to someone else: you're handing it off, not testing it.
                  setGoTest(!e.target.value || e.target.value === opts.meId);
                }}
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <p className="text-sm text-slate-600" aria-live="polite">
          {kindId === null ? (
            "Pick what kind of run it is."
          ) : !what ? (
            "Pick what to run."
          ) : what === "suite" && !suite ? (
            "Pick a suite."
          ) : runCount ? (
            <>
              Starts <b>{runCount === 1 ? "1 run" : `${runCount} runs`}</b> with <b>{count === 1 ? "1 case" : `${count} cases`}</b> in{" "}
              {[...chosen.map((c) => c.name), ...(makingCycle ? [`${newCycle.name.trim()} (new)`] : [])].join(", ")}
            </>
          ) : (
            "Tick a test cycle to start."
          )}
        </p>
        <div className="flex items-center gap-3">
          {runCount === 1 && kindId !== null && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={goTest} onChange={(e) => setGoTest(e.target.checked)} />
              Open the first case
            </label>
          )}
          <Button onClick={onClose}>Cancel</Button>
          {kindId !== null && (
            <Button variant="primary" disabled={pending || !runCount || !count} onClick={submit}>
              {pending ? "Starting…" : runCount > 1 ? `Start ${runCount} ${session ? "sessions" : "runs"}` : session ? "Start session" : kind ? `Start ${kind.name.toLowerCase()}` : "Start run"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type Kind = RunBoxOptions["kinds"][number];

/**
 * "What kind of run?" (ver_95): Smoke test, Release candidate, the umbrella's own kinds,
 * Bug bash and "+ New kind…". A kind's usual suite fills in what to run.
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
        : usual(k) || (k.builtIn ? "A quick check that the basics work" : "Your own kind of run");
  const shown = kinds.filter((k) => k.id !== "rc" || canRc);
  const chosen = kinds.find((k) => k.id === picked);
  if (chosen)
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
        What kind of run?
      </h3>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Kind of run">
        {shown.map((k) => (
          <button key={k.id} type="button" onClick={() => onPick(k.id)} className="rounded-md border border-slate-200 px-3 py-2 text-left hover:border-accent-500 hover:bg-slate-50">
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
