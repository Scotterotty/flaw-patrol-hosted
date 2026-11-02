"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { exploreOptions, startExploring, type ExploreOptions } from "@/server/explore";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Input } from "./ui";

/**
 * Start exploring: the charter's mission, a time limit, who explores and where
 * it goes. Always a 🧭 Exploratory run named "Explore: <charter>"; it opens the timer.
 */
export function StartExploringButton({ caseId, label = "▶ Start exploring", size, variant = "primary", className }: { caseId: string; label?: string; size?: "sm"; variant?: "primary" | "secondary"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Start exploring">
        {open && <Box caseId={caseId} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

/** The same box, opened by its caller (Create and start exploring on a requirement, ver_96). */
export function StartExploringModal({ caseId, open, onClose }: { caseId: string; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Start exploring">
      {open && <Box caseId={caseId} onClose={onClose} />}
    </Modal>
  );
}

function Box({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const [opts, setOpts] = useState<ExploreOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void exploreOptions(caseId).then((r) => live && (r.ok ? setOpts(r) : setError(r.error)));
    return () => {
      live = false;
    };
  }, [caseId]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!opts) return <p className="text-sm text-slate-500">Loading…</p>;
  return <Form opts={opts} onClose={onClose} />;
}

function Form({ opts, onClose }: { opts: ExploreOptions; onClose: () => void }) {
  const router = useRouter();
  const c = opts.charter;
  const [minutes, setMinutes] = useState(c.minutes);
  const [placeId, setPlaceId] = useState(opts.places[0]?.id ?? opts.library?.id ?? "");
  const [picking, setPicking] = useState(false);
  const [people, setPeople] = useState<string[]>([opts.meId]);
  const [name, setName] = useState(`Explore: ${c.title}`);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const members = opts.places.find((p) => p.id === placeId)?.members ?? opts.library?.members ?? [];
  const choices = [...new Set([30, 60, 90, c.minutes])].sort((a, b) => a - b);
  const go = () =>
    start(async () => {
      setError(null);
      const r = await startExploring(c.id, { placeId, minutes, people: picking ? people : null, name: name.trim() === `Explore: ${c.title}` ? "" : name });
      if (!r.ok) return setError(r.error);
      onClose();
      if (r.mine) router.push(`/p/${r.key}/runs/${r.mine.number}/execute?entry=${r.mine.entryId}`);
      else router.push(`/p/${r.key}/runs`);
      router.refresh();
    });
  return (
    <div className="space-y-4 text-sm" data-testid="start-exploring">
      <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3">
        <p className="font-medium text-slate-900">
          <span className="font-mono text-xs text-slate-500">{c.key}</span> · {c.title}
        </p>
        {(c.explore || c.discover) && (
          <p className="mt-1 text-slate-700">
            {c.explore && <>Explore {c.explore}</>}
            {c.with && <> with {c.with}</>}
            {c.discover && <> to discover {c.discover}</>}.
          </p>
        )}
        {c.persona && (
          <p className="mt-1.5 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">
            {c.persona.emoji} as {c.persona.name}
          </p>
        )}
      </div>
      <fieldset>
        <legend className="mb-1 font-medium text-slate-700">Time limit</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={cx("rounded-full border px-3 py-1", minutes === m ? "border-accent-500 bg-accent-50 font-medium text-accent-800" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
              {m} min{m === c.minutes && " (from the charter)"}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 font-medium text-slate-700">Who explores</legend>
        <div className="flex flex-wrap gap-2">
          {[
            { on: !picking, label: "Just me", set: () => setPicking(false) },
            { on: picking, label: "Pick people…", set: () => setPicking(true) },
          ].map((o) => (
            <button key={o.label} type="button" aria-pressed={o.on} onClick={o.set} className={cx("rounded-full border px-3 py-1", o.on ? "border-accent-500 bg-accent-50 font-medium text-accent-800" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
              {o.label}
            </button>
          ))}
        </div>
        {picking && (
          <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {members.map((m) => {
              const on = people.includes(m.id);
              return (
                <label key={m.id} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]", on ? "border-accent-500 bg-accent-50 text-accent-800" : "border-slate-200 text-slate-700")}>
                  <input type="checkbox" className="accent-accent-600" checked={on} onChange={() => setPeople((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))} />
                  {m.id === opts.meId ? `${m.name} (you)` : m.name}
                </label>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">Each person gets their own copy, so everyone has their own timer and notes.</p>
      </fieldset>
      {(opts.places.length > 1 || opts.library) && (
        <fieldset>
          <legend className="mb-1 font-medium text-slate-700">Where it goes</legend>
          <div className="flex flex-wrap gap-2">
            {[...opts.places.map((p, i) => ({ id: p.id, label: i === 0 ? `${p.name} (newest test cycle)` : p.name })), ...(opts.library ? [{ id: opts.library.id, label: "No test cycle" }] : [])].slice(0, 6).map((p) => (
              <button key={p.id} type="button" aria-pressed={placeId === p.id} onClick={() => setPlaceId(p.id)} className={cx("rounded-full border px-3 py-1", placeId === p.id ? "border-accent-500 bg-accent-50 font-medium text-accent-800" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        {renaming ? (
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        ) : (
          <p className="text-slate-600">
            Name: <span className="font-medium text-slate-900">{name}</span> ·{" "}
            <button type="button" className="text-accent-700 hover:underline" onClick={() => setRenaming(true)}>
              Change
            </button>
          </p>
        )}
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !placeId || (picking && !people.length)} onClick={go}>
          {pending ? "Starting…" : picking && people.length > 1 ? `Start ${people.length} copies` : "Start exploring"}
        </Button>
      </div>
    </div>
  );
}
