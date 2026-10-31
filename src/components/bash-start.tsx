"use client";

import { onStartKind, onStartPrefetch } from "@/lib/start-kind";
import { prefetchOn, useLazy } from "@/lib/use-lazy";
import { BoxWait } from "./box-wait";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LENGTHS, type BashLink } from "@/lib/bash";
import type { StartBoxData } from "@/lib/bash-data";
import { startBoxFor, startBugBash } from "@/server/bashes";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

type Area = { name: string; template: string | null; links?: BashLink[] };

/** Start a bug bash from the Risk board (ver_96): its requirements, riskiest first; High ones ticked. */
export type RiskPreset = { name: string; picks: { key: string; title: string; url: string; level: "High" | "Med" | "Low"; cases: number }[] };

/**
 * Start a bug bash (ver_93): name, length and areas, about 20 seconds. Everything else
 * has a default under More options. Then a link to share, a QR code and a Slack post.
 */
/** The box's area ideas and choices, fetched when it opens or is about to (ver_120). Boxes on one page share it. */
function useStartBox(projectId: string) {
  return useLazy(`bash:${projectId}`, async () => {
    const r = await startBoxFor(projectId);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });
}

export function StartBashButton({
  projectId,
  variant = "secondary",
  size,
  again,
  hideButton = false,
  preset,
  label,
}: {
  /** The project the button is on; the box finds the bash's home (the umbrella's hub) itself. */
  projectId: string;
  preset?: RiskPreset;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  again?: { name: string; areas: string[]; minutes: number };
  /** No button of its own (ver_95): Start a run's "Bug bash" kind opens it. */
  hideButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useStartBox(projectId);
  const { ensure, load } = box;
  useEffect(() => (again ? undefined : onStartKind("bash", () => setOpen(true))), [again]);
  useEffect(() => (again ? undefined : onStartPrefetch("bash", load)), [again, load]);
  useEffect(() => {
    if (open) ensure();
  }, [open, ensure]);
  return (
    <>
      {!hideButton && <Button variant={variant} size={size} onClick={() => setOpen(true)} {...prefetchOn(load)}>
        {again ? "Run it again" : label ?? (
          <>
            <span aria-hidden>🐞</span> Start a bug bash
          </>
        )}
      </Button>}
      <Modal open={open} onClose={() => setOpen(false)} title="Start a bug bash" wide>
        {open && <StartBashForm data={box.data} failed={box.failed} retry={box.reload} again={again} preset={preset} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

/** Opened with ?bash=start (Ctrl+K "Start a bug bash", or a link): the box opens by itself. */
export function StartBashAuto({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(true);
  const box = useStartBox(projectId);
  const { ensure } = box;
  useEffect(() => ensure(), [ensure]);
  const router = useRouter();
  const close = () => {
    setOpen(false);
    router.replace(window.location.pathname);
  };
  return (
    <Modal open={open} onClose={close} title="Start a bug bash" wide>
      {open && <StartBashForm data={box.data} failed={box.failed} retry={box.reload} onClose={close} />}
    </Modal>
  );
}

/** Until its data arrives (ver_120) the box takes a Name and How long; the area ideas show a spinner. */
const NO_DATA: StartBoxData = { homeId: "", homeKey: "", homeName: "", cycles: [], defaultCycleId: "", suggestions: [], last: null, templates: [], slackChannels: 0 };

function StartBashForm({
  data: loaded,
  failed,
  retry,
  again,
  preset,
  onClose,
}: {
  data: StartBoxData | null;
  failed: boolean;
  retry: () => void;
  again?: { name: string; areas: string[]; minutes: number };
  preset?: RiskPreset;
  onClose: () => void;
}) {
  const data = loaded ?? NO_DATA;
  const router = useRouter();
  const riskArea = (p: RiskPreset["picks"][number]): Area => ({ name: p.title || p.key, template: null, links: [{ kind: "jira", key: p.key, title: p.title, url: p.url }] });
  const [name, setName] = useState(again ? `${again.name} (again)` : (preset?.name ?? ""));
  const [minutes, setMinutes] = useState(again?.minutes ?? 60);
  const [areas, setAreas] = useState<Area[]>(again ? again.areas.map((a) => ({ name: a, template: null })) : preset ? preset.picks.filter((p) => p.level === "High").map(riskArea) : []);
  const isPicked = (key: string) => areas.some((a) => a.links?.some((l) => l.kind === "jira" && l.key === key));
  const [draft, setDraft] = useState("");
  const [more, setMore] = useState(false);
  const [later, setLater] = useState("");
  const [picked, setCycleId] = useState<string | null>(null);
  const cycleId = picked ?? data.defaultCycleId;
  const [tours, setTours] = useState(false);
  const [collectFirst, setCollectFirst] = useState(true);
  // On by default when there's a channel to post to, once that's known.
  const [slackPick, setSlack] = useState<boolean | null>(null);
  const slack = slackPick ?? data.slackChannels > 0;
  const [fun, setFun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ id: string; key: string; posted: string[]; later: boolean } | null>(null);

  const has = (n: string) => areas.some((a) => a.name.toLowerCase() === n.toLowerCase());
  const addArea = (n: string, links?: BashLink[]) => {
    const v = n.trim();
    if (!v || has(v) || areas.length >= 12) return;
    setAreas((a) => [...a, { name: v, template: null, ...(links && { links }) }]);
  };
  const suggestions = data.suggestions.filter((s) => !has(s.name) && !(s.link && isPicked(s.link.key)));

  if (done) return <Invite bashId={done.id} homeKey={done.key} posted={done.posted} later={done.later} onClose={onClose} />;

  const submit = () =>
    start(async () => {
      setError(null);
      const at = new Date();
      if (later) at.setHours(Number(later.split(":")[0]), Number(later.split(":")[1]), 0, 0);
      const startsAt = later ? at.toISOString() : "";
      const all = draft.trim() && !has(draft) ? [...areas, { name: draft.trim(), template: null }] : areas;
      const res = await startBugBash(data.homeId, { name, minutes, areas: all, startsAt, cycleId, collectFirst, slack, funExtras: fun });
      if (!res.ok) return setError(res.error);
      setDone({ id: res.id, key: res.key, posted: res.posted, later: !!later });
      router.refresh();
      retry();
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-semibold text-slate-900">Start a bug bash</h2>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Field label="Name" htmlFor="bash-name">
        <Input id="bash-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checkout bash" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-600">How long</legend>
        <div className="flex flex-wrap gap-2">
          {LENGTHS.map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={cx("rounded-full px-3 py-1 text-sm ring-1 ring-inset", minutes === m ? "bg-accent-600 font-medium text-white ring-accent-600" : "text-slate-700 ring-slate-200 hover:bg-slate-50")}>
              {m} min
            </button>
          ))}
        </div>
      </fieldset>
      {preset && (
        <fieldset data-testid="risk-picks">
          <legend className="mb-1.5 text-xs font-semibold text-slate-600">
            From the Risk board <span className="font-normal text-slate-500">· riskiest first. Each one you tick becomes an area, linked to its Jira issue.</span>
          </legend>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1.5">
            {preset.picks.map((p) => (
              <li key={p.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isPicked(p.key)}
                    onChange={(e) => (e.target.checked ? setAreas((a) => (a.length >= 12 ? a : [...a, riskArea(p)])) : setAreas((a) => a.filter((x) => !x.links?.some((l) => l.key === p.key))))}
                  />
                  <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-semibold", p.level === "High" ? "bg-red-100 text-red-800" : p.level === "Med" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>{p.level === "Med" ? "Medium" : p.level}</span>
                  <span className="font-mono text-xs text-slate-500">{p.key}</span>
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <span className="text-xs text-slate-500">{p.cases ? `${p.cases} ${p.cases === 1 ? "case" : "cases"}` : "No tests"}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          Areas to explore <InfoTip text="People pick one of these when they join. Each area gets its own charter, so the report shows what each one found." />
        </p>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-surface p-1.5">
          {areas.map((a, i) => (
            <span key={a.name} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-0.5 text-sm text-accent-800 ring-1 ring-accent-200 ring-inset" title={a.links?.map((l) => `${l.key} ${l.title}`).join(", ")}>
              {a.name}
              {a.links?.map((l) => (
                <span key={l.key} className="rounded bg-surface px-1 text-[10px] font-semibold text-slate-600">
                  {l.key}
                </span>
              ))}
              <button type="button" aria-label={`Remove ${a.name}`} className="text-accent-700 hover:text-accent-900" onClick={() => setAreas((all) => all.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          ))}
          <input
            aria-label="Add an area"
            className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
            placeholder={areas.length ? "Add another" : "Type an area and press Enter, like Checkout"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addArea(draft);
                setDraft("");
              } else if (e.key === "Backspace" && !draft && areas.length) setAreas((a) => a.slice(0, -1));
            }}
            onBlur={() => {
              addArea(draft);
              setDraft("");
            }}
          />
        </div>
        {!loaded && (
          <BoxWait compact testId="bash-ideas-wait" failed={failed} onRetry={retry}>
            Getting ideas for areas…
          </BoxWait>
        )}
        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Suggestions">
            <span className="text-slate-500">Suggestions, tap to add:</span>
            {suggestions.map((s) => (
              <button key={s.name} type="button" title={s.why} onClick={() => addArea(s.name, s.link ? [s.link] : undefined)} className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-slate-700 hover:border-accent-400 hover:bg-accent-50">
                {s.hot && <span aria-label="High risk">🔥 </span>}
                {s.name}
              </button>
            ))}
          </div>
        )}
        {data.last && !again && (
          <button type="button" className="mt-2 text-xs font-medium text-accent-700 hover:underline" onClick={() => data.last!.areas.forEach((a) => addArea(a))}>
            Use the same areas as the last bash ({data.last.name})
          </button>
        )}
      </div>
      {data.cycles.length > 1 && (
        // Up front (ver_94): a bash only counts toward a release when someone picks its test cycle.
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-slate-600">Where should its results go?</legend>
          <div className="space-y-1.5">
            {data.cycles.map((c, i) => (
              <label key={c.id} className={cx("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm", cycleId === c.id ? "border-accent-500 bg-accent-50" : "border-slate-200")}>
                <input type="radio" name="bash-cycle" className="mt-1" checked={cycleId === c.id} onChange={() => setCycleId(c.id)} />
                <span>
                  <span className="font-medium">{i === 0 ? "Don't attach to a test cycle" : c.name}</span>
                  <span className="block text-xs text-slate-500">
                    {i === 0 ? "Kept on its own. It never shows up as a platform's release testing." : "Its run sits in that test cycle, marked Bug bash."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <button type="button" className="text-sm text-slate-600 hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "▾" : "▸"} More options
        </button>
        {more && (
          <div className="mt-2 space-y-3 rounded-md bg-slate-50 p-3">
            <div className="flex flex-wrap gap-4">
              <Field label="Starts" htmlFor="bash-later" hint="Leave empty to start now">
                <Input id="bash-later" type="time" value={later} onChange={(e) => setLater(e.target.value)} className="w-36" />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={tours} onChange={(e) => setTours(e.target.checked)} />
              Give each area a tour or checklist from the gallery
            </label>
            {tours && areas.length > 0 && (
              <ul className="space-y-1.5 pl-6">
                {areas.map((a, i) => (
                  <li key={a.name} className="flex items-center gap-2 text-sm">
                    <span className="w-40 truncate">{a.name}</span>
                    <Select aria-label={`Tour for ${a.name}`} className="h-8 w-auto" value={a.template ?? ""} onChange={(e) => setAreas((all) => all.map((x, j) => (j === i ? { ...x, template: e.target.value || null } : x)))}>
                      <option value="">Blank charter</option>
                      {data.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={collectFirst} onChange={(e) => setCollectFirst(e.target.checked)} />
              <span>
                Collect bugs here first, send to Jira when we wrap up
                <span className="block text-xs text-slate-500">Recommended: duplicates get merged before anything reaches Jira. Untick to send each bug as it&apos;s logged.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={slack} disabled={!data.slackChannels} onChange={(e) => setSlack(e.target.checked)} />
              <span>
                Post the start, a 10-minute warning and the summary to Slack
                {!data.slackChannels && <span className="block text-xs text-slate-500">Add a channel in Settings → Slack alerts first.</span>}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={fun} onChange={(e) => setFun(e.target.checked)} />
              Show the fun extras (first bug, most bugs)
            </label>
          </div>
        )}
        {loaded && (
          <p className="mt-2 text-xs text-slate-500">
            Defaults: bugs collected first{data.slackChannels ? ", Slack on" : ""}, anyone in {data.homeName} can join.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending || !loaded || !name.trim() || (!areas.length && !draft.trim())}>
          {pending ? "Starting…" : later ? "Schedule bug bash" : "Start bug bash"}
        </Button>
      </div>
    </form>
  );
}

/** Your bash is live: copy the link, the Slack post, a QR code for the room. */
function Invite({ bashId, homeKey, posted, later, onClose }: { bashId: string; homeKey: string; posted: string[]; later: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState("");
  useEffect(() => setLink(`${window.location.origin}/p/${homeKey}/bashes/${bashId}/join`), [homeKey, bashId]);
  return (
    <div className="space-y-4" data-testid="bash-invite">
      <h2 className="text-lg font-semibold text-slate-900">{later ? "Your bash is scheduled. Invite people." : "Your bash is live. Invite people."}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={link} aria-label="Join link" className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="primary"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-sm text-slate-600">{posted.length ? `Posted to ${posted.map((p) => `#${p.replace(/^#/, "")}`).join(", ")} in Slack, with a Join the bash button.` : later ? "Slack gets the post when it starts." : "Share the link in chat or email. Joining takes one click: pick an area and go."}</p>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code for the join link" className="size-48 rounded border border-slate-200 bg-white p-2" />
      ) : (
        <button
          type="button"
          className="text-sm font-medium text-accent-700 hover:underline"
          onClick={async () => {
            const QR = await import("qrcode");
            setQr(await QR.toDataURL(link, { margin: 1, width: 384 }));
          }}
        >
          Show QR code
        </button>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <Button onClick={onClose}>Close</Button>
        <Link href={`/p/${homeKey}/bashes/${bashId}`} onClick={onClose} className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700">
          Open the bash
        </Link>
      </div>
    </div>
  );
}
