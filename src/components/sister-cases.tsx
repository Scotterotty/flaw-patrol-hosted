"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { missingKeys, type SisterStep, type Suggestion } from "@/lib/sisters";
import { removeSisterLink, saveSisterLink } from "@/server/sisters";
import { Button, cx, ErrorText } from "./ui";

// Sister cases (Case library › Sister cases): each dry run case with the cases it shares a test
// with, one per client, and the steps the dry run covers. Suggestions come from matching words;
// a person links them. Ticking a step saves straight away.

export type DryCase = { id: string; key: string; title: string; folder: string; text: string; clients: string[] };
export type LibCase = { id: string; key: string; href: string; title: string; folder: string; steps: SisterStep[] };
export type LinkRow = { id: string; fromCaseId: string; fromClient: string; toCaseId: string; steps: string[] };

type Filter = "all" | "look" | "none";

export function SisterCasesView({ projectId, dryName, dry, lib, links: start, canEdit }: { projectId: string; dryName: string; dry: (DryCase & { suggestions: Suggestion[] })[]; lib: LibCase[]; links: LinkRow[]; canEdit: boolean }) {
  const [links, setLinks] = useState(start);
  const [gone, setGone] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, run] = useTransition();
  const byId = useMemo(() => new Map(lib.map((c) => [c.id, c])), [lib]);

  const suggestionsOf = (d: (typeof dry)[number]) =>
    d.suggestions.filter((s) => !gone.includes(`${d.id}|${s.client}|${s.caseId}`) && !links.some((l) => l.fromCaseId === d.id && (l.toCaseId === s.caseId || (s.client && l.fromClient === s.client))));
  const needsLook = (l: LinkRow) => {
    const c = byId.get(l.toCaseId);
    return !c || (l.steps.length > 0 && missingKeys(c.steps, l.steps).length > 0);
  };
  const shown = dry.filter((d) => {
    const mine = links.filter((l) => l.fromCaseId === d.id);
    if (filter === "look") return mine.some(needsLook);
    if (filter === "none") return !mine.length;
    return true;
  });
  const allSuggested = dry.flatMap((d) => suggestionsOf(d).map((s) => ({ d, s })));
  const lookCount = dry.filter((d) => links.some((l) => l.fromCaseId === d.id && needsLook(l))).length;
  const noneCount = dry.filter((d) => !links.some((l) => l.fromCaseId === d.id)).length;

  const save = (row: Omit<LinkRow, "id">, done?: string) =>
    new Promise<boolean>((resolve) =>
      run(async () => {
        setError(null);
        const r = await saveSisterLink(projectId, row);
        if (!r.ok) {
          setError(r.error);
          return resolve(false);
        }
        setLinks((ls) => [...ls.filter((l) => !(l.fromCaseId === row.fromCaseId && l.fromClient === row.fromClient && l.toCaseId === row.toCaseId)), { ...row, id: r.id }]);
        if (done) setNote(done);
        resolve(true);
      }),
    );
  const remove = (l: LinkRow) =>
    run(async () => {
      setError(null);
      const r = await removeSisterLink(projectId, l.id);
      if (!r.ok) return setError(r.error);
      setLinks((ls) => ls.filter((x) => x.id !== l.id));
      setNote("Link removed. Steps it filled before keep their results.");
    });
  const linkAll = () =>
    run(async () => {
      let n = 0;
      for (const { d, s } of allSuggested) {
        const r = await saveSisterLink(projectId, { fromCaseId: d.id, fromClient: s.client, toCaseId: s.caseId, steps: s.steps });
        if (!r.ok) return setError(r.error);
        n++;
        setLinks((ls) => [...ls, { id: r.id, fromCaseId: d.id, fromClient: s.client, toCaseId: s.caseId, steps: s.steps }]);
      }
      setNote(`Linked ${n} suggested ${n === 1 ? "sister" : "sisters"}. Untick any step a dry run case doesn't cover.`);
    });

  return (
    <div className="space-y-3" data-testid="sister-cases">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All ${dry.length}`],
              ["look", `Needs a look · ${lookCount}`],
              ["none", `No sister yet · ${noneCount}`],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cx("min-h-9 rounded-full border px-3 text-sm", filter === f ? "border-accent-500 bg-accent-50 font-medium text-accent-800" : "border-slate-200 bg-surface text-slate-700 hover:border-slate-300")}>
              {label}
            </button>
          ))}
        </div>
        {canEdit && allSuggested.length > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" disabled={pending} onClick={linkAll} data-howto="sister-link-all">
            Link all suggested ({allSuggested.length})
          </Button>
        )}
      </div>
      {note && (
        <p role="status" className="text-sm text-emerald-800">
          ✓ {note}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {!dry.length && <p className="text-sm text-slate-600">{dryName} has no cases yet.</p>}
      <ul className="space-y-2">
        {shown.map((d) => {
          const mine = links.filter((l) => l.fromCaseId === d.id);
          const sugg = suggestionsOf(d);
          return (
            <li key={d.id} className="grid gap-3 rounded-lg border border-slate-200 bg-surface p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="sister-row">
              <div className="min-w-0">
                <span className="font-mono text-xs text-accent-700">{d.key}</span>
                <h2 className="font-semibold text-slate-900">{d.title}</h2>
                <p className="text-xs text-slate-600">
                  {d.folder}
                  {d.clients.length > 0 && <> · {d.clients.join(", ")}</>}
                </p>
              </div>
              <div className="min-w-0 space-y-2">
                {mine.map((l) => {
                  const c = byId.get(l.toCaseId);
                  return (
                    <SisterLine
                      key={l.id}
                      client={l.fromClient}
                      c={c}
                      steps={l.steps}
                      badge={needsLook(l) ? "look" : "linked"}
                      canEdit={canEdit}
                      pending={pending}
                      onSteps={(steps) => save({ fromCaseId: d.id, fromClient: l.fromClient, toCaseId: l.toCaseId, steps })}
                      onRemove={() => remove(l)}
                      label={`${d.title} → ${c?.key ?? "case"}`}
                    />
                  );
                })}
                {sugg.map((s) => (
                  <Suggested
                    key={`${s.client}|${s.caseId}`}
                    s={s}
                    c={byId.get(s.caseId)}
                    canEdit={canEdit}
                    pending={pending}
                    label={`${d.title} → ${byId.get(s.caseId)?.key ?? "case"}`}
                    onLink={(steps) => save({ fromCaseId: d.id, fromClient: s.client, toCaseId: s.caseId, steps }, `Linked ${d.title} to ${byId.get(s.caseId)?.title ?? "its sister"}.`)}
                    onSkip={() => setGone((g) => [...g, `${d.id}|${s.client}|${s.caseId}`])}
                  />
                ))}
                {!mine.length && !sugg.length && <p className="text-sm text-slate-600">No sister. Results stay in the dry run.</p>}
                {canEdit &&
                  (adding === d.id ? (
                    <AddSister clients={d.clients} lib={lib} pending={pending} onCancel={() => setAdding(null)} onPick={async (client, c) => (await save({ fromCaseId: d.id, fromClient: client, toCaseId: c.id, steps: [] }, `Linked ${d.title} to ${c.title}.`)) && setAdding(null)} />
                  ) : (
                    <button type="button" className="min-h-9 text-sm font-medium text-accent-700 hover:underline" onClick={() => setAdding(d.id)}>
                      + Add a sister
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Platform({ client }: { client: string }) {
  return client ? <span className="rounded bg-blue-50 px-1.5 text-xs font-semibold text-blue-800 ring-1 ring-blue-200 ring-inset">{client}</span> : null;
}

/** The step boxes: no keys means every step. */
function StepBoxes({ c, steps, disabled, onChange, label }: { c: LibCase; steps: string[]; disabled: boolean; onChange: (steps: string[]) => void; label: string }) {
  if (!c.steps.length) return <p className="text-xs text-slate-600">The whole case (it has one step).</p>;
  const on = (k: string) => !steps.length || steps.includes(k);
  const toggle = (k: string) => {
    const now = c.steps.map((s) => s.key).filter((x) => (x === k ? !on(x) : on(x)));
    if (!now.length) return;
    onChange(now.length === c.steps.length ? [] : now);
  };
  return (
    <fieldset className="flex flex-wrap gap-x-3 gap-y-1" data-howto="sister-steps">
      <legend className="sr-only">Steps the dry run covers: {label}</legend>
      {c.steps.map((s) => (
        <label key={s.key} className={cx("inline-flex min-h-8 items-center gap-1.5 text-xs", on(s.key) ? "font-medium text-slate-900" : "text-slate-600")}>
          <input type="checkbox" checked={on(s.key)} disabled={disabled} onChange={() => toggle(s.key)} />
          {s.label}
        </label>
      ))}
    </fieldset>
  );
}

function CaseName({ c }: { c: LibCase | undefined }) {
  if (!c) return <span className="text-sm text-slate-600">A case that was deleted or archived</span>;
  return (
    <Link href={c.href} className="min-w-0 text-sm text-slate-900 hover:underline">
      <span className="font-mono text-xs text-accent-700">{c.key}</span> {c.title}
    </Link>
  );
}

function SisterLine({ client, c, steps, badge, canEdit, pending, onSteps, onRemove, label }: { client: string; c: LibCase | undefined; steps: string[]; badge: "linked" | "look"; canEdit: boolean; pending: boolean; onSteps: (s: string[]) => void; onRemove: () => void; label: string }) {
  // A link whose steps were edited away: tick what it covers now.
  const kept = c ? steps.filter((k) => c.steps.some((s) => s.key === k)) : steps;
  return (
    <div className={cx("space-y-1.5 rounded-md border px-2.5 py-2", badge === "look" ? "border-amber-400" : "border-slate-200")} data-testid="sister-link">
      <div className="flex flex-wrap items-center gap-2">
        <Platform client={client} />
        <CaseName c={c} />
        {badge === "look" ? <span className="rounded bg-amber-50 px-1.5 text-xs font-semibold text-amber-800">Steps changed. Tick them again.</span> : <span className="rounded bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-800">Linked</span>}
        {canEdit && (
          <button type="button" onClick={onRemove} disabled={pending} className="ml-auto min-h-8 px-1 text-xs text-slate-600 hover:text-red-700" aria-label={`Remove link: ${label}`}>
            Remove
          </button>
        )}
      </div>
      {c && <StepBoxes c={c} steps={badge === "look" && !kept.length ? c.steps.map((s) => s.key) : kept} disabled={!canEdit || pending} onChange={onSteps} label={label} />}
    </div>
  );
}

function Suggested({ s, c, canEdit, pending, onLink, onSkip, label }: { s: Suggestion; c: LibCase | undefined; canEdit: boolean; pending: boolean; onLink: (steps: string[]) => void; onSkip: () => void; label: string }) {
  const [steps, setSteps] = useState(s.steps);
  if (!c) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-2" data-testid="sister-suggestion">
      <div className="flex flex-wrap items-center gap-2">
        <Platform client={s.client} />
        <CaseName c={c} />
        <span className="rounded bg-amber-50 px-1.5 text-xs font-semibold text-amber-800">Suggested</span>
        {canEdit && (
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" disabled={pending} onClick={() => onLink(steps)} aria-label={`Link: ${label}`} data-howto="sister-link">
              Link
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip} aria-label={`Not a sister: ${label}`}>
              Not a sister
            </Button>
          </span>
        )}
      </div>
      <StepBoxes c={c} steps={steps} disabled={!canEdit || pending} onChange={setSteps} label={label} />
    </div>
  );
}

function AddSister({ clients, lib, pending, onPick, onCancel }: { clients: string[]; lib: LibCase[]; pending: boolean; onPick: (client: string, c: LibCase) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [client, setClient] = useState(clients[0] ?? "");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? lib.filter((c) => words.every((w) => `${c.key} ${c.title} ${c.folder}`.toLowerCase().includes(w))).slice(0, 8) : [];
  return (
    <div className="space-y-2 rounded-md border border-accent-300 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        {clients.length > 0 && (
          <label className="text-xs font-medium text-slate-700">
            Filled from
            <select value={client} onChange={(e) => setClient(e.target.value)} className="mt-0.5 block min-h-9 rounded-md border border-slate-300 bg-surface px-2 text-sm">
              {clients.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <label className="min-w-48 flex-1 text-xs font-medium text-slate-700">
          Sister case
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or key" className="mt-0.5 block min-h-9 w-full rounded-md border border-slate-300 bg-surface px-2 text-sm" />
        </label>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {hits.length > 0 && (
        <ul className="divide-y divide-slate-100" aria-label="Matching cases">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={pending} onClick={() => onPick(client, c)} className="block min-h-9 w-full px-1 py-1.5 text-left text-sm hover:bg-slate-50">
                <span className="font-mono text-xs text-accent-700">{c.key}</span> {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {words.length > 0 && !hits.length && <p className="text-xs text-slate-600">No case matches that.</p>}
    </div>
  );
}
