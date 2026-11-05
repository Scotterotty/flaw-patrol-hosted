"use client";

import { onStartKind, onStartPrefetch } from "@/lib/start-kind";
import { prefetchOn, useLazy } from "@/lib/use-lazy";
import { BoxWait } from "./box-wait";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LENGTHS, releaseHint, type BashLink } from "@/lib/bash";
import type { StartBoxData } from "@/lib/bash-data";
import { startBoxFor, startBugBash } from "@/server/bashes";
import { localBoxes, localInstant, nextHour, startProblem, whenLabel } from "@/lib/bash-schedule";
import { AddToCalendar, WhenBoxes, type CalendarBash } from "./bash-schedule";
import { Modal } from "./modal";
import { useZone } from "./spelling";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

type Area = { name: string; template: string | null; links?: BashLink[] };

/** Start a bug bash from the Risk board: its requirements, riskiest first; High ones ticked. */
export type RiskPreset = { name: string; picks: { key: string; title: string; url: string; level: "High" | "Med" | "Low"; cases: number }[] };

/**
 * Start a bug bash: name, length and areas, about 20 seconds. Everything else
 * has a default under More options. Then a link to share, a QR code and a Slack post.
 */
/** The box's area ideas and choices, fetched when it opens or is about to. Boxes on one page share it. */
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
  /** No button of its own: Create a run's "Bug bash" kind opens it. */
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
      {!hideButton && <Button variant={variant} size={size} onClick={() => setOpen(true)} {...prefetchOn(load)} data-howto={again ? undefined : "bash-start"}>
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

/** Until its data arrives the box takes a Name and How long; the area ideas show a spinner. */
const NO_DATA: StartBoxData = { homeId: "", homeKey: "", homeName: "", releases: [], suggestions: [], last: null, templates: [], slackChannels: 0, bugTemplates: [], bugTemplateDefault: null, platforms: [], askPlatform: false, environments: [] };

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
  // When? (ver_153): now, or a date and time days ahead.
  const [later, setLaterOn] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const pickLater = () => {
    if (!day) {
      const b = localBoxes(nextHour());
      setDay(b.day);
      setTime(b.time);
    }
    setLaterOn(true);
  };
  // The release it counts toward (ver_152); "" keeps it on its own, the default.
  const [release, setRelease] = useState("");
  const [tours, setTours] = useState(false);
  const [collectFirst, setCollectFirst] = useState(true);
  // On by default when there's a channel to post to, once that's known.
  const [slackPick, setSlack] = useState<boolean | null>(null);
  const slack = slackPick ?? data.slackChannels > 0;
  const [fun, setFun] = useState(false);
  // Bug template: the team's default until someone picks; "" is the plain one-line bug.
  const [tplPick, setTpl] = useState<string | null>(null);
  const bugTemplateId = tplPick ?? data.bugTemplateDefault ?? "";
  // Platforms (ver_146): on with the umbrella's (or last bash's) list until someone changes it.
  const [askPick, setAsk] = useState<boolean | null>(null);
  const askPlatform = askPick ?? data.askPlatform;
  const [platPick, setPlats] = useState<string[] | null>(null);
  const platforms = platPick ?? data.platforms;
  const [platDraft, setPlatDraft] = useState("");
  const addPlatform = (n: string) => {
    const v = n.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!v || platforms.some((p) => p.toLowerCase() === v.toLowerCase()) || platforms.length >= 12) return;
    setPlats([...platforms, v]);
    setAsk(true);
  };
  // What people are testing (ver_172): all optional.
  const [build, setBuild] = useState("");
  const [environment, setEnvironment] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ id: string; key: string; posted: string[]; later: CalendarBash | null } | null>(null);

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
      const at = later ? localInstant(day, time) : null;
      if (later) {
        const problem = startProblem(at);
        if (problem) return setError(problem);
      }
      const startsAt = at ? at.toISOString() : "";
      const all = draft.trim() && !has(draft) ? [...areas, { name: draft.trim(), template: null }] : areas;
      const plats = platDraft.trim() ? [...platforms, platDraft.trim()] : platforms;
      const res = await startBugBash(data.homeId, { name, minutes, areas: all, startsAt, release, collectFirst, slack, funExtras: fun, bugTemplateId: bugTemplateId || null, platforms: askPlatform ? plats : [], build, environment, link });
      if (!res.ok) return setError(res.error);
      setDone({ id: res.id, key: res.key, posted: res.posted, later: at ? { id: res.id, name: name.trim(), startsAt: at.toISOString(), endsAt: new Date(at.getTime() + minutes * 60_000).toISOString(), areas: all.map((a) => a.name), by: res.by, homeKey: res.key } : null });
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
        <Input id="bash-name" data-howto="bash-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checkout bash" />
      </Field>
      <fieldset data-howto="bash-length">
        <legend className="mb-1.5 text-xs font-semibold text-slate-600">How long</legend>
        <div className="flex flex-wrap gap-2">
          {LENGTHS.map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={cx("rounded-full px-3 py-1 text-sm ring-1 ring-inset", minutes === m ? "bg-accent-600 font-medium text-white ring-accent-600" : "text-slate-700 ring-slate-200 hover:bg-slate-50")}>
              {m} min
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset data-testid="bash-when">
        <legend className="mb-1.5 text-xs font-semibold text-slate-600">When?</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { on: !later, label: "Now", pick: () => setLaterOn(false) },
            { on: later, label: "Pick a date and time", pick: pickLater },
          ].map((c) => (
            <button key={c.label} type="button" aria-pressed={c.on} onClick={c.pick} className={cx("rounded-full px-3 py-1 text-sm ring-1 ring-inset", c.on ? "bg-accent-600 font-medium text-white ring-accent-600" : "text-slate-700 ring-slate-200 hover:bg-slate-50")}>
              {c.label}
            </button>
          ))}
        </div>
        {later && (
          <div className="mt-2">
            <WhenBoxes idPrefix="bash-later" day={day} time={time} onDay={setDay} onTime={setTime} />
            <p className="mt-1 text-xs text-slate-500">It opens by itself then. Everyone sees the time on their own clock.</p>
          </div>
        )}
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
            data-howto="bash-areas"
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
      <fieldset data-testid="bash-setup">
        <legend className="mb-1.5 text-xs font-semibold text-slate-600">
          What are people testing? <span className="font-normal text-slate-500">(optional)</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Build" htmlFor="bash-build">
            <Input id="bash-build" value={build} maxLength={120} onChange={(e) => setBuild(e.target.value)} placeholder="Like 2.4.1 (812)" />
          </Field>
          <Field label="Environment" htmlFor="bash-env">
            <Input id="bash-env" list="bash-env-list" value={environment} maxLength={120} onChange={(e) => setEnvironment(e.target.value)} placeholder="Like Staging" />
            <datalist id="bash-env-list">
              {data.environments.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Link" htmlFor="bash-link">
              <Input id="bash-link" inputMode="url" value={link} maxLength={2000} onChange={(e) => setLink(e.target.value)} placeholder="Paste a web address: a page, a download, a PR or a Jira issue" />
            </Field>
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">Everyone sees these when they join, and each bug gets the build and environment. You can change them during the bash.</p>
      </fieldset>
      {loaded && (
        <fieldset data-testid="bash-platforms" className="rounded-md border border-slate-200 p-3">
          <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" className="mt-1" checked={askPlatform} onChange={(e) => setAsk(e.target.checked)} />
            <span>
              Ask people which platform they&apos;re on
              <span className="block text-xs font-normal text-slate-500">
                {askPlatform
                  ? data.platforms.length && !platPick
                    ? "Optional for them. Each bug keeps the platform it was found on, and the report counts bugs per platform."
                    : "Optional for them. Add the platforms you're testing, like Web or iPhone. People can also type their own."
                  : "Off: nobody is asked. Turn it on to see bugs per platform in the report."}
              </span>
            </span>
          </label>
          {askPlatform && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-surface p-1.5">
              {platforms.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-0.5 text-sm text-accent-800 ring-1 ring-accent-200 ring-inset">
                  {p}
                  <button type="button" aria-label={`Remove platform ${p}`} className="text-accent-700 hover:text-accent-900" onClick={() => setPlats(platforms.filter((x) => x !== p))}>
                    ×
                  </button>
                </span>
              ))}
              <input
                aria-label="Add a platform"
                className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
                placeholder={platforms.length ? "Add another" : "Type a platform and press Enter, like Web"}
                value={platDraft}
                onChange={(e) => setPlatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addPlatform(platDraft);
                    setPlatDraft("");
                  } else if (e.key === "Backspace" && !platDraft && platforms.length) setPlats(platforms.slice(0, -1));
                }}
                onBlur={() => {
                  addPlatform(platDraft);
                  setPlatDraft("");
                }}
              />
            </div>
          )}
        </fieldset>
      )}
      {data.releases.length > 0 && (
        // Up front: a bash only counts toward a release when someone picks one.
        <fieldset data-testid="bash-release">
          <legend className="mb-1.5 text-xs font-semibold text-slate-600">Count it toward a release?</legend>
          <div role="radiogroup" aria-label="Count it toward a release?" className="flex flex-wrap gap-1.5">
            {["", ...data.releases].map((r) => (
              <button
                key={r || "none"}
                type="button"
                role="radio"
                aria-checked={release === r}
                onClick={() => setRelease(r)}
                className={cx("rounded-full border px-3 py-1 text-[13px]", release === r ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400")}
              >
                {r || "No, keep it on its own"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{releaseHint(release, askPlatform ? platforms : [])}</p>
        </fieldset>
      )}
      {data.bugTemplates.length > 0 && (
        <fieldset data-testid="bash-bug-template">
          <legend className="mb-1.5 text-xs font-semibold text-slate-600">Bug template</legend>
          <div role="radiogroup" aria-label="Bug template" className="flex flex-wrap gap-1.5">
            {[{ id: "", name: "Plain bug", hint: "" }, ...data.bugTemplates].map((t) => (
              <button
                key={t.id || "plain"}
                type="button"
                role="radio"
                aria-checked={bugTemplateId === t.id}
                onClick={() => setTpl(t.id)}
                className={cx("rounded-full border px-3 py-1 text-[13px]", bugTemplateId === t.id ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400")}
              >
                {t.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {bugTemplateId ? `Bugs in this bash use ${data.bugTemplates.find((t) => t.id === bugTemplateId)?.name ?? "it"}${bugTemplateId === data.bugTemplateDefault ? ", your team's default" : ""}. People can still switch for one bug while they log it.` : "One line, how bad and any details, like before."}
          </p>
        </fieldset>
      )}
      <div>
        <button type="button" className="text-sm text-slate-600 hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "▾" : "▸"} More options
        </button>
        {more && (
          <div className="mt-2 space-y-3 rounded-md bg-slate-50 p-3">
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
        <Button type="submit" variant="primary" disabled={pending || !loaded || !name.trim() || (!areas.length && !draft.trim())} data-howto="bash-go">
          {pending ? "Starting…" : later ? "Schedule bug bash" : "Start bug bash"}
        </Button>
      </div>
    </form>
  );
}

/** Your bash is live: copy the link, the Slack post, a QR code for the room. */
function Invite({ bashId, homeKey, posted, later, onClose }: { bashId: string; homeKey: string; posted: string[]; later: CalendarBash | null; onClose: () => void }) {
  const zone = useZone();
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState("");
  useEffect(() => setLink(`${window.location.origin}/p/${homeKey}/bashes/${bashId}?join=1`), [homeKey, bashId]);
  return (
    <div className="space-y-4" data-testid="bash-invite">
      <h2 className="text-lg font-semibold text-slate-900">{later ? `Your bash is scheduled for ${whenLabel(later.startsAt, zone).replace(" · ", " at ")}. Invite people.` : "Your bash is live. Invite people."}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={link} aria-label="Join link" className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="primary"
          data-howto="bash-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        {later && <AddToCalendar bash={later} />}
      </div>
      <p className="text-sm text-slate-600">{posted.length && later ? `Posted a heads-up to ${posted.map((p) => `#${p.replace(/^#/, "")}`).join(", ")} in Slack. It posts again with a Join button when the bash starts.` : posted.length ? `Posted to ${posted.map((p) => `#${p.replace(/^#/, "")}`).join(", ")} in Slack, with a Join the bash button.` : later ? "Add it to your calendar, then send the link or the calendar invite to people." : "Share the link in chat or email. Joining takes one click: pick an area and go."}</p>
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
