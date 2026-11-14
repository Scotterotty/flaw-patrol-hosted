"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { auditNeedsComment, CLAIM_MS, fieldChanges, KEEP_MS, OUTCOMES, outcomeLabel, type AuditIssue, type Editable, type Outcome } from "@/lib/bug-audit";
import { fileSize } from "@/lib/bug-board";
import { claimAuditBug, keepAuditBug, nextAuditBug, openAuditBug, releaseAuditBug, verifyAuditBug } from "@/server/bug-audit";
import { JiraAdf } from "./jira-adf";
import { Button, Card, cx, ErrorText, Input, Select } from "./ui";

export type AuditListBug = AuditIssue;
export type AuditRecent = { issueKey: string; title: string; outcome: string; clients: string[]; checkedBy: string; checkedAt: string; movedTo: string };
type Holder = { name: string; mine: boolean };
type Opened = Extract<Awaited<ReturnType<typeof openAuditBug>>, { ok: true }>;
type Progress = { left: number; done: number; holding: number; pace: { days: number; perDay: number } | null };

const BUILD_KEY = "fp-audit-build";
const PICK_KEY = "fp-audit-pick";
const LIVE_MS = 15_000;
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const chip = (on: boolean) => cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", on ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700 hover:border-accent-500");

/** Bugs → Audit (ver_250): Next bug, the bug in full with its Jira fields to fix, and Verify and next. */
export function AuditWorkbench({
  groupId,
  audit,
  site,
  issues,
  more,
  holders,
  progress,
  recent,
  platforms,
  canCheck,
  error: loadError,
}: {
  groupId: string;
  audit: { id: string; name: string; label: string; filterUrl: string; settings: string | null };
  site: string;
  issues: AuditListBug[];
  more: boolean;
  holders: Record<string, Holder>;
  progress: Progress;
  recent: AuditRecent[];
  platforms: string[];
  canCheck: boolean;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(loadError);
  const [pick, setPick] = useState({ platform: "", component: "" });
  const [skipped, setSkipped] = useState<string[]>([]);
  const [bug, setBug] = useState<{ key: string; data: Opened | null; heldBy: string | null } | null>(null);
  const [none, setNone] = useState(false);
  // The list is open whenever no bug is (ver_251): it folds away while you check one.
  const [browse, setBrowse] = useState(true);
  useEffect(() => {
    try {
      const saved = JSON.parse(store.get(PICK_KEY) || "{}");
      setPick({ platform: String(saved.platform ?? ""), component: String(saved.component ?? "") });
    } catch {}
  }, []);
  const components = useMemo(() => [...new Set(issues.flatMap((i) => i.components))].sort(), [issues]);
  const mineNow = Object.entries(holders).find(([, h]) => h.mine)?.[0] ?? null;

  const open = useCallback(async (key: string, heldBy: string | null) => {
    setBug({ key, data: null, heldBy });
    setBrowse(false);
    const r = await openAuditBug(audit.id, key);
    if (!r.ok) {
      setError(r.error);
      setBug(null);
      setBrowse(true);
      return;
    }
    setBug({ key, data: r, heldBy });
  }, [audit.id]);

  const next = (skip: string[] = skipped) =>
    start(async () => {
      setError(null);
      setNone(false);
      const r = await nextAuditBug(audit.id, { ...pick, skip });
      if (!r.ok) return setError(r.error);
      if (!r.key) {
        setBug(null);
        setBrowse(true);
        setNone(true);
        return;
      }
      await open(r.key, null);
      router.refresh();
    });

  // Release (ver_252): let a bug go without checking it, from the bug or from the list. Nothing changes in Jira.
  const release = (key: string) =>
    start(async () => {
      const r = await releaseAuditBug(audit.id, key);
      if (!r.ok) return setError(r.error);
      setBug((b) => (b?.key === key ? null : b));
      setBrowse(true);
      router.refresh();
    });

  const take = (key: string) =>
    start(async () => {
      setError(null);
      setBrowse(false);
      const r = await claimAuditBug(audit.id, key);
      // Someone else has it: show it read-only, with who.
      if (!r.ok) {
        if (/ is checking /.test(r.error)) return open(key, r.error.split(" is checking ")[0]);
        return setError(r.error);
      }
      await open(key, null);
      router.refresh();
    });

  // Live (ver_256): refresh every 15 seconds while the page is on screen, and as soon as you come back
  // to the tab, so everyone's checks, claims and counts show up without reloading. A refresh keeps the
  // open bug and anything typed in it. Checks made here show within 15 seconds; labels changed in Jira
  // take up to a minute or two (the Jira read is shared and cached for a minute).
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !pendingRef.current) router.refresh();
    };
    const timer = setInterval(refresh, LIVE_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  // Back on the page with a bug still yours: carry on with it.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !mineNow || !canCheck) return;
    resumed.current = true;
    void open(mineNow, null);
  }, [mineNow, canCheck, open]);

  const savePick = (p: typeof pick) => {
    setPick(p);
    store.set(PICK_KEY, JSON.stringify(p));
  };

  const total = progress.left + progress.done;
  const pct = (n: number) => (total ? `${Math.max(n ? 0.5 : 0, (n / total) * 100)}%` : "0%");

  return (
    <div className="flex flex-col gap-4" data-testid="bug-audit">
      <div>
        <p className="mb-1.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-700" data-testid="audit-progress">
          <span className="font-medium text-emerald-700">{progress.done} checked</span>
          <span aria-hidden>·</span>
          <span className="text-amber-700">{progress.holding} being checked</span>
          <span aria-hidden>·</span>
          <span>
            {progress.left}
            {more ? "+" : ""} left
          </span>
          {progress.pace && (
            <>
              <span aria-hidden>·</span>
              <span>
                {progress.pace.days === 1 ? "last day" : `${progress.pace.days} days left`}, about {progress.pace.perDay} a day
              </span>
            </>
          )}
          <a href={audit.filterUrl} target="_blank" rel="noreferrer" className="ml-auto text-accent-700 hover:underline">
            Filter in Jira ↗
          </a>
          {audit.settings && (
            <a href={audit.settings} className="text-accent-700 hover:underline">
              Audit settings
            </a>
          )}
        </p>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="bg-emerald-600" style={{ width: pct(progress.done) }} />
          <div className="bg-amber-500" style={{ width: pct(progress.holding) }} />
        </div>
      </div>

      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

      {canCheck && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => next()} disabled={pending} data-testid="audit-next" data-howto="audit-next">
            ▶ Next bug
          </Button>
          <span className="text-sm text-slate-600">from</span>
          <Select value={pick.platform} onChange={(e) => savePick({ ...pick, platform: e.target.value })} className="w-auto" aria-label="Platform">
            <option value="">Any platform</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select value={pick.component} onChange={(e) => savePick({ ...pick, component: e.target.value })} className="w-auto max-w-full min-w-40" aria-label="Component">
            <option value="">Any component</option>
            {components.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <button type="button" className="ml-auto text-sm text-accent-700 hover:underline" onClick={() => setBrowse((b) => !b)} aria-expanded={browse}>
            {browse ? "Hide the list" : `Browse the list (${issues.length})`}
          </button>
        </div>
      )}

      {none && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Nothing left that fits. Try Any platform and Any component, or everything&apos;s been checked.</p>}

      {(browse || !canCheck) && <BugList issues={issues} holders={holders} onPick={canCheck ? take : null} onRelease={canCheck ? release : null} openKey={bug?.key ?? null} />}

      {bug && (
        <BugCheck
          key={bug.key}
          auditId={audit.id}
          label={audit.label}
          groupId={groupId}
          site={site}
          bugKey={bug.key}
          data={bug.data}
          heldBy={bug.heldBy}
          platforms={platforms}
          onReload={() => open(bug.key, bug.heldBy)}
          onDone={() => {
            router.refresh();
            next(skipped);
          }}
          onSkip={() => {
            const skip = [...skipped, bug.key];
            setSkipped(skip);
            next(skip);
          }}
          onLetGo={() => release(bug.key)}
        />
      )}

      {recent.length > 0 && <Recent list={recent} site={site} />}
    </div>
  );
}

function BugList({ issues, holders, onPick, onRelease, openKey }: { issues: AuditListBug[]; holders: Record<string, Holder>; onPick: ((key: string) => void) | null; onRelease: ((key: string) => void) | null; openKey: string | null }) {
  const [q, setQ] = useState("");
  const shown = issues.filter((i) => !q || `${i.key} ${i.title} ${i.components.join(" ")}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <Card className="overflow-hidden" data-testid="audit-list">
      <div className="border-b border-slate-200 p-2">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bugs, keys or components" aria-label="Search the audit" className="w-full" />
      </div>
      <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
        {shown.map((i) => {
          const h = holders[i.key];
          return (
            <li key={i.key} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-20 shrink-0 font-mono text-xs text-accent-700">{i.key}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-900">{i.title}</span>
                <span className="block truncate text-xs text-slate-500">{[i.components.join(", "), i.status, i.priority].filter(Boolean).join(" · ")}</span>
              </span>
              {h?.mine ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-700">Yours</span>
                  {onPick && openKey !== i.key && (
                    <Button size="sm" onClick={() => onPick(i.key)}>
                      Open
                    </Button>
                  )}
                  {onRelease && (
                    <Button size="sm" onClick={() => onRelease(i.key)} title="Let it go without checking it. Nothing changes in Jira." data-testid="audit-list-release">
                      Release
                    </Button>
                  )}
                </span>
              ) : h ? (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{h.name} checking</span>
              ) : (
                onPick && (
                  <Button size="sm" onClick={() => onPick(i.key)}>
                    Check this
                  </Button>
                )
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-3 py-4 text-sm text-slate-600">No bugs match.</li>}
      </ul>
    </Card>
  );
}

function ListField({ label, value, options, onChange }: { label: string; value: string[]; options: string[] | null; onChange: (v: string[]) => void }) {
  if (!options) return <ReadField label={label} value={value.join(", ") || "None"} />;
  const left = options.filter((o) => !value.includes(o));
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((v) => (
          <button key={v} type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="inline-flex min-h-9 items-center rounded-full border border-slate-300 px-3 text-xs text-slate-800 hover:border-red-400 sm:min-h-0 sm:px-2 sm:py-0.5" aria-label={`Remove ${v}`}>
            {v} ✕
          </button>
        ))}
        {left.length > 0 && (
          <select className="h-7 max-w-36 rounded border border-slate-300 bg-surface px-1 text-xs text-slate-700" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label={`Add ${label.toLowerCase()}`}>
            <option value="">+ add</option>
            {left.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <p className="truncate text-sm text-slate-800">{value}</p>
    </div>
  );
}

const CLOSING = /closed|done|resolved|won't|wont|cannot|can't/i;

function BugCheck({
  auditId,
  label,
  groupId,
  site,
  bugKey,
  data,
  heldBy,
  platforms,
  onReload,
  onDone,
  onSkip,
  onLetGo,
}: {
  auditId: string;
  label: string;
  groupId: string;
  site: string;
  bugKey: string;
  data: Opened | null;
  heldBy: string | null;
  platforms: string[];
  onReload: () => void;
  onDone: () => void;
  onSkip: () => void;
  onLetGo: () => void;
}) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [clients, setClients] = useState<string[]>([]);
  const [build, setBuild] = useState("");
  const [note, setNote] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [edits, setEdits] = useState<Editable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => setBuild(store.get(BUILD_KEY)), []);
  useEffect(() => {
    if (data) {
      setEdits(data.editable);
      heading.current?.focus();
    }
  }, [data]);
  const canVerify = !heldBy && !!data && !!edits;
  // The bug stays yours while you work on it: any click, key or scroll renews the claim every few
  // minutes. After 15 minutes with no activity on the page, it goes back on the list (a closed page
  // lets it go on the server the same way).
  const [lost, setLost] = useState(false);
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (heldBy || !data || lost) return;
    const active = () => (lastActive.current = Date.now());
    const events = ["pointerdown", "keydown", "input", "scroll", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true, capture: true });
    let lastKeep = Date.now();
    const timer = setInterval(async () => {
      const now = Date.now();
      if (now - lastActive.current >= CLAIM_MS) {
        setLost(true);
        await releaseAuditBug(auditId, bugKey);
      } else if (now - lastKeep >= KEEP_MS && now - lastActive.current < KEEP_MS) {
        lastKeep = now;
        const r = await keepAuditBug(auditId, bugKey);
        if (r.ok && !r.kept) setLost(true);
      }
    }, 30_000);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, active, { capture: true });
    };
  }, [auditId, bugKey, heldBy, data, lost]);
  const takeBack = () =>
    start(async () => {
      const r = await claimAuditBug(auditId, bugKey);
      if (!r.ok) return setError(r.error);
      lastActive.current = Date.now();
      setLost(false);
    });

  const verify = (force = false) => {
    if (!data || !edits) return;
    if (!outcome) return setError("Pick what you found first.");
    if (lost) return setError("Take the bug back first: it went back on the list while the page was idle.");
    start(async () => {
      setError(null);
      store.set(BUILD_KEY, build);
      const r = await verifyAuditBug(auditId, bugKey, { outcome, clients, build, note, edits, seen: data.editable, seenUpdated: data.updated, moveTo, force });
      if (!r.ok) return setError(r.error);
      if (r.conflict) return setConflict(r.conflict);
      onDone();
    });
  };

  // 1 to 5 pick what you found; Enter saves. Not while typing in a box.
  const verifyRef = useRef(verify);
  verifyRef.current = verify;
  useEffect(() => {
    if (!canVerify) return;
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const o = OUTCOMES.find((x) => x.key === e.key);
      if (o) {
        e.preventDefault();
        setOutcome(o.id);
      } else if (e.key === "Enter" && (t?.tagName ?? "") !== "BUTTON" && (t?.tagName ?? "") !== "A") {
        e.preventDefault();
        verifyRef.current();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [canVerify]);

  const t = data?.ticket;
  const file = (id: string, name: string) => `/api/bug-board/file?g=${encodeURIComponent(groupId)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
  const closeMove = data?.moves.find((m) => CLOSING.test(m.to));
  const suggestClose = (outcome === "cant" || outcome === "fixed" || outcome === "dupe") && closeMove && moveTo !== closeMove.id;
  // ver_255: say exactly what lands in Jira, and change as the outcome, note, fields and status change.
  const comment = outcome ? auditNeedsComment(outcome, note) : null;
  const saving = data && edits && fieldChanges(data.editable, edits).length > 0;
  const moving = data?.moves.find((m) => m.id === moveTo)?.to;

  return (
    <Card className="flex flex-col gap-3 p-4 ring-1 ring-accent-500" data-testid="audit-bug">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-medium text-accent-700">{bugKey}</span>
        {heldBy ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" data-testid="audit-held">
            {heldBy} is checking this
          </span>
        ) : (
          <span className="rounded-full bg-accent-50 px-2 py-0.5 text-accent-700">Yours</span>
        )}
        {data && <span className="rounded border border-slate-200 px-1.5 py-px text-slate-700">{data.status}</span>}
        {t && <span className="text-slate-600">{[t.reporter && `Reporter ${t.reporter}`, t.created && `since ${new Date(t.created).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`].filter(Boolean).join(" · ")}</span>}
        <a href={`${site}/browse/${bugKey}`} target="_blank" rel="noreferrer" className="ml-auto text-sm text-accent-700 hover:underline">
          Jira ↗
        </a>
      </div>

      {!data || !edits ? (
        <p className="text-sm text-slate-600">Loading from Jira…</p>
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="sr-only">
            {edits.summary}
          </h2>
          {data.options.summary && canVerify ? (
            <Input value={edits.summary} onChange={(e) => setEdits({ ...edits, summary: e.target.value })} aria-label="Summary" className="w-full text-base font-medium" />
          ) : (
            <p className="text-base font-medium text-slate-900">{edits.summary}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.options.priority && canVerify ? (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">Priority</p>
                <Select value={edits.priority} onChange={(e) => setEdits({ ...edits, priority: e.target.value })} aria-label="Priority" className="w-full">
                  {!data.options.priority.includes(edits.priority) && <option value={edits.priority}>{edits.priority || "None"}</option>}
                  {data.options.priority.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <ReadField label="Priority" value={edits.priority || "None"} />
            )}
            <ListField label="Components" value={edits.components} options={canVerify ? data.options.components : null} onChange={(components) => setEdits({ ...edits, components })} />
            <ListField label="Affects version" value={edits.versions} options={canVerify ? data.options.versions : null} onChange={(versions) => setEdits({ ...edits, versions })} />
          </div>

          {t && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
              <div className="flex flex-col gap-2">
                {t.repro ? (
                  <details open className="rounded-lg border border-slate-200 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-slate-900">Repro steps</summary>
                    <div className="mt-2">
                      <JiraAdf doc={t.repro} empty="No repro steps in Jira." />
                    </div>
                  </details>
                ) : null}
                <details open={!t.repro} className="rounded-lg border border-slate-200 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-slate-900">Description</summary>
                  <div className="mt-2">
                    <JiraAdf doc={t.description} empty="No description in Jira." />
                  </div>
                </details>
                <p className="text-xs text-slate-500">To rewrite the steps or description, use Jira ↗. Your other changes here save with Verify.</p>
              </div>
              <div className="flex flex-col gap-2 text-sm">
                {t.attachments.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {t.attachments.slice(0, 6).map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        {/^image\/(png|jpeg|gif|webp)$/.test(a.type) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={file(a.id, a.name)} alt="" loading="lazy" className="size-10 rounded border border-slate-200 object-cover" />
                        )}
                        <a href={file(a.id, a.name)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent-700 underline">
                          {a.name}
                        </a>
                        <span className="shrink-0 text-xs text-slate-500">{fileSize(a.size)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.comments.slice(0, 3).map((c) => (
                  <div key={c.id} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">{c.author}</span> · {new Date(c.created).toLocaleDateString()}
                    </p>
                    <JiraAdf doc={c.body} empty="" />
                  </div>
                ))}
                {t.comments.length === 0 && t.attachments.length === 0 && <p className="text-xs text-slate-500">No comments or files.</p>}
              </div>
            </div>
          )}

          {heldBy ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{heldBy} has this bug, so you can look but not check it. Press Next bug for one of your own.</p>
          ) : (
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-3">
              <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
              {lost && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" data-testid="audit-lost">
                  <span className="min-w-0 flex-1">This page was idle for 15 minutes, so {bugKey} went back on the list for someone else.</span>
                  <Button size="sm" onClick={takeBack} disabled={pending}>
                    Take it back
                  </Button>
                </div>
              )}
              {conflict && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert" data-testid="audit-conflict">
                  <p className="font-medium">Someone changed {bugKey} in Jira while you had it open:</p>
                  <ul className="my-1 list-disc pl-5">
                    {conflict.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => (setConflict(null), onReload())}>
                      Show me theirs
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => (setConflict(null), verify(true))}>
                      Save mine over it
                    </Button>
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">What did you find?</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What did you find?" data-howto="audit-outcome">
                  {OUTCOMES.map((o) => (
                    <button key={o.id} type="button" role="radio" aria-checked={outcome === o.id} className={chip(outcome === o.id)} onClick={() => setOutcome(o.id)}>
                      {o.label}
                      {/* Number keys mean nothing on a touchscreen (ver_255): the hint shows only with a mouse; the keys still work. */}
                      <kbd className="hidden rounded border border-slate-300 px-1 text-[10px] text-slate-500 pointer-fine:inline">{o.key}</kbd>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {platforms.map((p) => (
                  <button key={p} type="button" aria-pressed={clients.includes(p)} className={chip(clients.includes(p))} onClick={() => setClients((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]))}>
                    {p}
                  </button>
                ))}
                <Input value={build} onChange={(e) => setBuild(e.target.value)} placeholder="Build checked" aria-label="Build checked" className="w-40" />
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" className="min-w-40 flex-1" />
              </div>
              {data.moves.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-slate-600">Status in Jira</span>
                  <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="w-auto" aria-label="Status in Jira">
                    <option value="">Leave as {data.status}</option>
                    {data.moves.map((m) => (
                      <option key={m.id} value={m.id}>
                        Move to {m.to}
                      </option>
                    ))}
                  </Select>
                  {suggestClose && (
                    <button type="button" className="text-accent-700 hover:underline" onClick={() => setMoveTo(closeMove.id)}>
                      Move it to {closeMove.to} too?
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => verify()} disabled={pending} data-testid="audit-verify" data-howto="audit-verify">
                  Verify and next
                </Button>
                <Button onClick={onSkip} disabled={pending}>
                  Skip
                </Button>
                <Button onClick={onLetGo} disabled={pending} title="Let it go without checking it, so someone else can take it. Nothing changes in Jira." data-testid="audit-release">
                  Release
                </Button>
                <span className="text-xs text-slate-600" aria-live="polite" data-testid="audit-verify-hint">
                  {saving && "Saves your changes to Jira. "}
                  Adds <code className="text-accent-700">{label}</code>
                  {comment === null ? ". Pick what you found: Still happens adds no comment unless you type a note." : comment ? " and a comment." : ". No comment. Type a note if you want one."}
                  {moving && ` Moves it to ${moving}.`}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Recent({ list, site }: { list: AuditRecent[]; site: string }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-surface px-3 py-2" data-testid="audit-recent">
      <summary className="cursor-pointer text-sm font-medium text-slate-900">Checked so far in Flaw Patrol ({list.length >= 40 ? "newest 40" : list.length})</summary>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {list.map((r) => (
          <li key={r.issueKey} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
            <a href={`${site}/browse/${r.issueKey}`} target="_blank" rel="noreferrer" className="w-20 shrink-0 font-mono text-xs text-accent-700 hover:underline">
              {r.issueKey}
            </a>
            <span className="min-w-0 flex-1 truncate text-slate-800">{r.title}</span>
            <span className="text-xs text-slate-700">
              {outcomeLabel(r.outcome)}
              {r.clients.length ? ` on ${r.clients.join(", ")}` : ""}
              {r.movedTo ? ` · moved to ${r.movedTo}` : ""}
            </span>
            <span className="text-xs text-slate-500">{r.checkedBy.split(/\s+/)[0]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
