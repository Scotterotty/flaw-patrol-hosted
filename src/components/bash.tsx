"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Severity } from "@prisma/client";
import { BASH_SEVERITIES, sevLabel, similarBugs, type BashSeverity, type ItemKind } from "@/lib/bash";
import type { BashView } from "@/lib/bash-summary";
import { clock } from "@/lib/charter";
import { bashBugFiled, coverBashPrompt, deleteBashItem, endBashEarly, joinBash, logBashItem, mergeBashItems, plusOneBash, reviewBashItem, wrapUpBash } from "@/server/bashes";
import { uploadAttachment } from "@/server/results";
import { BugDialog } from "./bug-dialog";
import { PromptsCard } from "./session-runner";
import { takeScreenshot, useCaptureSupport } from "./screen-capture";
import { Button, Card, cx, ErrorText, InfoTip, Textarea } from "./ui";

type Item = BashView["items"][number];

/**
 * Seconds left until `iso`, ticking every second. Null until the page is running in the
 * browser (ver_94): the server's clock differs, and that mismatch made React redo the page
 * and drop the first tap.
 */
export function useSecondsLeft(iso: string) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.round((new Date(iso).getTime() - Date.now()) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  return left;
}

/** "38:12 left", "Ended", or "Starts in 4:00". */
export function Countdown({ bash, className }: { bash: Pick<BashView, "startsAt" | "endsAt" | "phase">; className?: string }) {
  const toStart = useSecondsLeft(bash.startsAt);
  const left = useSecondsLeft(bash.endsAt);
  const router = useRouter();
  const flipped = useRef(false);
  // When the clock runs out, the page reloads into its next state.
  useEffect(() => {
    if (flipped.current || left === null || toStart === null) return;
    if ((bash.phase === "live" && left <= 0) || (bash.phase === "scheduled" && toStart <= 0)) {
      flipped.current = true;
      router.refresh();
    }
  }, [left, toStart, bash.phase, router]);
  if (bash.phase === "scheduled") return <span className={className}>Starts in {toStart === null ? "…" : clock(Math.max(0, toStart))}</span>;
  if (bash.phase !== "live") return <span className={className}>Ended</span>;
  return (
    <span role="timer" aria-live="off" className={cx("tabular-nums", left !== null && left < 600 && "text-orange-700", className)}>
      {left === null ? "…" : clock(Math.max(0, left))} left
    </span>
  );
}

const SEV_TONE: Record<string, string> = {
  SHOWSTOPPER: "bg-red-700 text-white",
  CRITICAL: "bg-red-50 text-red-800 ring-1 ring-red-200",
  PROBLEMATIC: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  MINOR: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  ENHANCEMENT: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
};
/** A bash severity chip; `name` is what it files as in the team's list, shown on hover. */
export function SevChip({ s, name }: { s: Severity; name?: string }) {
  return (
    <span title={name ? `Files as ${name}` : undefined} className={cx("inline-block w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold", SEV_TONE[s])}>
      {sevLabel(s)}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Join: pick an area, Start exploring. Nobody needs to know what a charter or a run is. */
export function JoinPicker({ bash }: { bash: BashView }) {
  const router = useRouter();
  const [pick, setPick] = useState(bash.me.areaId ?? [...bash.areas].sort((a, b) => a.people.length - b.people.length)[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fewest = Math.min(...bash.areas.map((a) => a.people.length));
  return (
    <Card className="mx-auto max-w-xl p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Pick an area</h2>
        <Countdown bash={bash} className="text-sm text-slate-600" />
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div role="radiogroup" aria-label="Area" className="space-y-2">
        {bash.areas.map((a) => (
          <label key={a.id} className={cx("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5", pick === a.id ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-slate-200 hover:bg-slate-50")}>
            <input type="radio" name="area" checked={pick === a.id} onChange={() => setPick(a.id)} />
            <span className="min-w-0 flex-1">
              <b className="block text-sm text-slate-900">{a.name}</b>
              <span className="block text-xs text-slate-500">{a.prompts.length ? `${a.prompts.length} things to try` : "Explore freely"}</span>
            </span>
            <span className="text-xs text-slate-600">
              {a.people.length} in{a.people.length === fewest && bash.areas.length > 1 && <span className="ml-1 text-amber-700">· needs people</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">You can switch areas any time.</span>
        <Button
          variant="primary"
          disabled={!pick || pending || bash.phase === "wrapped"}
          onClick={() =>
            start(async () => {
              const r = await joinBash(bash.id, pick);
              if (!r.ok) return setError(r.error);
              router.push(`/p/${bash.homeKey}/bashes/${bash.id}/explore`);
            })
          }
        >
          {pending ? "Joining…" : "Start exploring"}
        </Button>
      </div>
    </Card>
  );
}

const KIND_LABEL: Record<ItemKind, string> = { bug: "Bug", question: "Question", note: "Note", idea: "Idea", covered: "Covered" };

/**
 * The bash runner (ver_93): a Log a bug box on top (press B to jump to it), one line is
 * enough. As you type it checks the bash's bug list and offers "+1, I see it too".
 */
export function BashExplore({ bash }: { bash: BashView }) {
  const router = useRouter();
  const area = bash.areas.find((a) => a.id === bash.me.areaId)!;
  const [text, setText] = useState("");
  const [details, setDetails] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [severity, setSeverity] = useState<BashSeverity>("PROBLEMATIC");
  const [kind, setKind] = useState<"bug" | "question" | "note" | "idea">("bug");
  const [files, setFiles] = useState<{ id: string; fileName: string }[]>([]);
  const [different, setDifferent] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const capture = useCaptureSupport();
  const live = bash.phase === "live";

  // Press B anywhere (outside a text box) to jump to Log a bug.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "b" || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      e.preventDefault();
      setKind("bug");
      box.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const upload = useCallback(
    async (list: File[]) => {
      setUploading(true);
      for (const f of list) {
        const form = new FormData();
        form.set("file", f);
        const r = await uploadAttachment(bash.runProjectId, form);
        if (r.ok) setFiles((a) => [...a, { id: r.attachment.id, fileName: r.attachment.fileName }]);
        else setError(r.error);
      }
      setUploading(false);
    },
    [bash.runProjectId],
  );
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const list = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!list.length || !live) return;
      e.preventDefault();
      void upload(list);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload, live]);

  const bugs = bash.items.filter((i) => i.kind === "bug" && !i.mergedIntoId);
  const match = kind === "bug" && text.trim().length > 8 ? similarBugs(text, bugs.filter((b) => b.byId !== bash.me.id && !different.has(b.id)))[0] : undefined;
  const mine = bash.items.filter((i) => i.byId === bash.me.id && i.kind !== "covered");
  const covered = new Set(bash.items.filter((i) => i.kind === "covered" && i.areaId === area.id && i.byId === bash.me.id).map((i) => i.text));
  const ago = (iso: string) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? "just now" : `${m} min ago`;
  };

  const log = () =>
    start(async () => {
      setError(null);
      const r = await logBashItem(bash.id, { kind, text, details, severity, attachmentIds: files.map((f) => f.id) });
      if (!r.ok) return setError(r.error);
      setText("");
      setDetails("");
      setShowDetails(false);
      setFiles([]);
      setNote(r.filed ? (r.filed.startsWith("Logged") ? r.filed : `Filed as ${r.filed}.`) : null);
      router.refresh();
      box.current?.focus();
    });

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">Log a {KIND_LABEL[kind].toLowerCase()}</h2>
            <span className="text-xs text-slate-500">
              Press <kbd className="rounded border border-slate-300 px-1">B</kbd>
            </span>
          </div>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {note && <p className="mt-2 rounded-md bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">{note}</p>}
          <input
            ref={box}
            aria-label="What did you find?"
            autoFocus
            disabled={!live}
            className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-surface px-3 text-base focus:border-accent-500 focus:ring-2 focus:ring-accent-200 focus:outline-none"
            placeholder={kind === "bug" ? "What went wrong? One line is enough" : kind === "question" ? "What do you need to ask?" : kind === "idea" ? "What else is worth trying?" : "What did you notice?"}
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !match) {
                e.preventDefault();
                log();
              }
            }}
          />
          {match && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset" role="status" data-testid="bash-match">
              <p>
                {match.byName} logged “{match.text}” {ago(match.at)}
                {match.plusOnes.length > 0 && ` · ${match.plusOnes.length} more saw it`}
              </p>
              <div className="mt-1.5 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await plusOneBash(match.id, true);
                      if (!r.ok) return setError(r.error);
                      setText("");
                      setNote(`Added you to ${match.byName}'s bug.`);
                      router.refresh();
                    })
                  }
                >
                  +1, I see it too
                </Button>
                <Button size="sm" onClick={() => setDifferent((d) => new Set(d).add(match.id))}>
                  It&apos;s different
                </Button>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="group" aria-label="Kind" className="flex gap-1">
              {(["bug", "question", "note", "idea"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cx("rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset", kind === k ? "bg-slate-800 font-semibold text-slate-50 ring-slate-800" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {kind === "bug" && (
              <div role="radiogroup" aria-label="How bad?" className="flex items-center gap-1 text-xs">
                <span className="mr-1 text-slate-500">How bad?</span>
                {BASH_SEVERITIES.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={severity === s.id} title={`Files as ${bash.sevNames[s.id]}`} onClick={() => setSeverity(s.id)} className={cx("rounded-full px-2.5 py-0.5 ring-1 ring-inset", severity === s.id ? "bg-accent-600 font-semibold text-white ring-accent-600" : "text-slate-700 ring-slate-200 hover:bg-slate-50")}>
                    {s.label}
                  </button>
                ))}
                <span className="ml-1 text-slate-500" data-testid="bash-files-as">Files as {bash.sevNames[severity]}</span>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">📋 Paste a screenshot, or</span>
            <Button size="sm" disabled={!live || uploading || !capture.ok} title={capture.ok ? undefined : capture.why} onClick={async () => {
              try {
                const f = await takeScreenshot(`bash-${Date.now()}.png`);
                if (f) await upload([f]);
              } catch {
                setError("The screen couldn't be captured. Paste a screenshot instead.");
              }
            }}>
              Capture screen
            </Button>
            <Button size="sm" disabled={!live || uploading} onClick={() => fileInput.current?.click()}>
              Attach file
            </Button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ""; if (l.length) void upload(l); }} />
            {uploading && <span className="text-slate-500">Uploading…</span>}
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                📎 {f.fileName}
                <button type="button" aria-label={`Remove ${f.fileName}`} onClick={() => setFiles((a) => a.filter((x) => x.id !== f.id))}>
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="ml-auto font-medium text-accent-700 hover:underline" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
              Add steps and details
            </button>
          </div>
          {showDetails && <Textarea className="mt-2" rows={3} aria-label="Steps and details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Steps to see it, what you expected, anything else" />}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">Area, time and your name are filled in for you.</span>
            <Button variant="primary" disabled={!live || pending || !text.trim()} onClick={log}>
              Log {KIND_LABEL[kind].toLowerCase()}
            </Button>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Your finds this bash · {mine.length}</h2>
          {mine.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {mine.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1.5">
                  <span className="w-12 shrink-0 text-xs text-slate-400 tabular-nums">{clock((new Date(i.at).getTime() - new Date(bash.startsAt).getTime()) / 1000)}</span>
                  {i.kind === "bug" ? <SevChip s={i.severity} /> : <span className="w-14 shrink-0 text-[11px] font-semibold text-slate-500 uppercase">{KIND_LABEL[i.kind as ItemKind]}</span>}
                  <span className="min-w-0 flex-1 truncate">{i.text}</span>
                  {i.plusOnes.length > 0 && <span className="text-xs text-slate-500">+{i.plusOnes.length}</span>}
                  {i.bug ? (
                    <span className="font-mono text-xs text-red-700">{i.bug.externalKey ?? `D-${i.bug.number}`}</span>
                  ) : (
                    live && (
                      <button
                        type="button"
                        aria-label={`Remove ${i.text}`}
                        className="text-slate-300 hover:text-slate-700"
                        onClick={() =>
                          start(async () => {
                            await deleteBashItem(i.id);
                            router.refresh();
                          })
                        }
                      >
                        ×
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <aside className="space-y-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Bash ends in</p>
          <Countdown bash={bash} className="text-3xl font-semibold text-slate-900" />
          <p className="mt-3 text-xs text-slate-500">Your area</p>
          <p className="text-sm font-medium text-slate-900">{area.name}</p>
          <Link href={`/p/${bash.homeKey}/bashes/${bash.id}/join`} className="text-xs font-medium text-accent-700 hover:underline">
            Switch area
          </Link>
          <p className="mt-3">
            <Link href={`/p/${bash.homeKey}/bashes/${bash.id}`} className="text-xs text-slate-600 hover:underline">
              Watch the board
            </Link>
          </p>
        </Card>
        {area.prompts.length > 0 && (
          <PromptsCard
            prompts={area.prompts}
            covered={covered}
            disabled={!live}
            onToggle={(p, on) =>
              start(async () => {
                await coverBashPrompt(bash.id, p, on);
                router.refresh();
              })
            }
          />
        )}
      </aside>
    </div>
  );
}

/** The bash board: one countdown, who's where, and the bug list as it grows. */
export function BashBoard({ bash }: { bash: BashView }) {
  const router = useRouter();
  const [show, setShow] = useState<string>("all");
  const [pending, start] = useTransition();
  const [ending, setEnding] = useState(false);
  const bugs = bash.items.filter((i) => i.kind === "bug" && !i.mergedIntoId);
  const shown = bugs.filter((b) => show === "all" || (show === "mine" ? b.byId === bash.me.id : b.areaId === show));
  const plusOnes = bugs.reduce((n, b) => n + b.plusOnes.length, 0);
  const questions = bash.items.filter((i) => i.kind === "question").length;
  const covered = bash.areas.filter((a) => a.people.length).length;
  const counts = new Map<string, number>();
  for (const b of bugs) if (b.byId) counts.set(b.byId, (counts.get(b.byId) ?? 0) + 1);
  const first = [...bugs].sort((a, b) => a.at.localeCompare(b.at))[0];
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const areaName = (id: string) => bash.areas.find((a) => a.id === id)?.name ?? "";
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {bash.phase === "scheduled" ? "Starts" : "Started"} {time(bash.startsAt)} by {bash.createdBy} · {bash.people.length} {bash.people.length === 1 ? "person" : "people"}
        </p>
        <div className="flex items-center gap-2">
          <Countdown bash={bash} className="mr-2 text-2xl font-semibold text-slate-900" />
          {bash.phase !== "wrapped" && (
            <Link href={`/p/${bash.homeKey}/bashes/${bash.id}/${bash.me.areaId ? "explore" : "join"}`} className="inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700">
              {bash.me.areaId ? "Back to exploring" : "Join"}
            </Link>
          )}
          {bash.isOwner && bash.phase === "live" && !ending && (
            <Button disabled={pending} onClick={() => setEnding(true)}>
              End early
            </Button>
          )}
          {bash.isOwner && bash.phase === "live" && ending && (
            // In-page confirm (ver_94), not a browser pop-up.
            <span role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
              End the bash now? Everyone&apos;s finds are kept.
              <Button
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await endBashEarly(bash.id);
                    router.refresh();
                  })
                }
              >
                Yes, end it
              </Button>
              <Button size="sm" onClick={() => setEnding(false)}>
                Keep going
              </Button>
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          [bugs.length, "Bugs logged"],
          [plusOnes, "+1s on existing bugs"],
          [questions, "Questions"],
          [`${covered} / ${bash.areas.length}`, "Areas with someone in"],
        ].map(([n, label]) => (
          <Card key={label as string} className="p-3">
            <p className="text-2xl font-semibold text-slate-900 tabular-nums">{n}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-sm font-semibold text-slate-800">Bug list</h2>
            {[["all", "All"], ...bash.areas.map((a) => [a.id, a.name]), ["mine", "Mine"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={show === id} onClick={() => setShow(id)} className={cx("rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset", show === id ? "bg-accent-600 text-white ring-accent-600" : "text-slate-700 ring-slate-200 hover:bg-slate-50")}>
                {label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{bugs.length ? "Nothing here." : "No bugs yet. The first one wins bragging rights."}</p>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Bugs">
              {shown.map((b) => (
                <li key={b.id} className="flex items-center gap-2 py-2 text-sm">
                  <SevChip s={b.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{b.text}</span>
                    <span className="block text-xs text-slate-500">
                      {areaName(b.areaId)} · {b.byName} · {time(b.at)}
                    </span>
                  </span>
                  {b.plusOnes.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700" title={b.plusOnes.map((p) => p.name).join(", ")}>+{b.plusOnes.length}</span>}
                  {b.bug && <span className="font-mono text-xs text-red-700">{b.bug.externalKey ?? `D-${b.bug.number}`}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Who&apos;s where</h2>
            {bash.people.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody has joined yet. Share the link.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {bash.people.slice(0, 12).map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-accent-100 text-[10px] font-semibold text-accent-800">{initials(p.name)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {p.name} · {areaName(p.areaId)}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">{counts.get(p.id) ?? 0}</span>
                  </li>
                ))}
                {bash.people.length > 12 && <li className="text-xs text-slate-500">+ {bash.people.length - 12} more</li>}
              </ul>
            )}
          </Card>
          {bash.funExtras && (first || most) && (
            <Card className="p-4" aria-label="Fun extra">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">Fun extra</h2>
              {first && <p className="text-sm">🥇 First bug: {first.byName} at {time(first.at)}</p>}
              {most && <p className="text-sm">🔥 Most bugs so far: {bash.people.find((p) => p.id === most[0])?.name ?? bugs.find((b) => b.byId === most[0])?.byName} ({most[1]})</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * File this bug… (ver_94): the usual bug box, filled in from a bash bug that isn't
 * in Jira yet, at wrap-up or on the report. Filing it marks the bash bug filed.
 */
export function FileBashBug({ bug, projectId, entryId, jiraConnected }: { bug: { id: string; text: string; details: string; severity: Severity; attachments: { id: string; fileName: string; contentType: string }[] }; projectId: string; entryId: string | null; jiraConnected: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!entryId) return <span className="text-xs text-slate-500">Its area isn&apos;t in the run anymore</span>;
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        File this bug…
      </Button>
      {error && <span className="block text-xs text-red-700">{error}</span>}
      <BugDialog
        open={open}
        onClose={() => setOpen(false)}
        onLinked={async (d) => {
          const r = await bashBugFiled(bug.id, d.id);
          if (!r.ok) setError(r.error);
          router.refresh();
        }}
        projectId={projectId}
        entryId={entryId}
        stepIndex={null}
        stepLabel="bug bash"
        actual={bug.details || bug.text}
        attachments={bug.attachments.map((a) => ({ ...a, label: "From the bash" }))}
        jiraConnected={jiraConnected}
        recent={[]}
        prefill={{ title: bug.text, severity: bug.severity }}
      />
    </>
  );
}

/** "Not filed" with Jira's reason, or "Left out" for a bug someone unticked. */
export function UnfiledTag({ left, why }: { left: boolean; why?: string }) {
  return (
    <>
      <span className={cx("ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold", left ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800")}>{left ? "Left out" : "Not filed"}</span>
      {!left && why && <span className="block text-xs text-red-700">{why}</span>}
    </>
  );
}

/**
 * Wrap up (ver_93, ver_94): whoever started it reviews the bugs, +1s already rolled in.
 * Untick File it to leave a bug out, adjust severity, merge duplicates, then file and
 * wrap up. If Jira refuses any, the screen stays with the reason and File this bug….
 */
export function WrapUp({ bash, jiraConnected }: { bash: BashView; jiraConnected: boolean }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A tick or severity shows at once; the server catches up on refresh (ver_94).
  const [mine, setMine] = useState<Record<string, { review?: "file" | "skip"; severity?: BashSeverity }>>({});
  const bugs = useMemo(() => bash.items.filter((i) => i.kind === "bug" && !i.mergedIntoId).map((i) => ({ ...i, ...mine[i.id] })), [bash.items, mine]);
  const toFile = bugs.filter((b) => b.review === "file" && !b.bug);
  const failed = toFile.filter((b) => b.fileError);
  const tried = bugs.filter((b) => b.review === "file" && (b.bug || b.fileError));
  const plusOnes = bugs.reduce((n, b) => n + b.plusOnes.length, 0);
  const people = new Set([...bash.people.map((p) => p.id), ...bash.items.map((i) => i.byId)]).size;
  const byArea = bash.areas.map((a) => ({ name: a.name, n: bugs.filter((b) => b.areaId === a.id).length })).sort((x, y) => y.n - x.n)[0];
  const areaName = (id: string) => bash.areas.find((a) => a.id === id)?.name ?? "";
  const review = (id: string, data: { review?: "file" | "skip"; severity?: BashSeverity }) => {
    setMine((m) => ({ ...m, [id]: { ...m[id], ...data } }));
    start(async () => {
      const r = await reviewBashItem(id, data);
      if (!r.ok) {
        setError(r.error);
        setMine((m) => ({ ...m, [id]: {} }));
      }
      router.refresh();
    });
  };
  const wrap = (anyway: boolean) =>
    start(async () => {
      setError(null);
      const r = await wrapUpBash(bash.id, anyway);
      if (!r.ok) return setError(r.error);
      if (!r.wrapped) return router.refresh();
      // A full page load: the wrapped bash page redirects to its report while a soft push races it and can stall on Filing… (ver_94).
      window.location.assign(`/p/${bash.homeKey}/bashes/${bash.id}/report`);
    });
  const plural = (n: number) => `${n} ${n === 1 ? "bug" : "bugs"}`;
  const label = pending ? "Filing…" : toFile.length ? `File ${plural(toFile.length)}${jiraConnected ? " to Jira" : ""} and wrap up` : "Wrap up";
  if (!bash.isOwner)
    return (
      <Card className="p-5 text-sm text-slate-700">
        The bash is over. {bash.createdBy} is wrapping it up and filing the bugs. The report shows here once that&apos;s done.
      </Card>
    );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          [toFile.length, "Bugs to file"],
          [plusOnes, "+1s rolled in"],
          [people, "People"],
          [byArea?.n ? `${byArea.name}` : "None", byArea?.n ? `Most bugs (${byArea.n})` : "Most bugs"],
        ].map(([n, label]) => (
          <Card key={label as string} className="p-3">
            <p className="truncate text-2xl font-semibold text-slate-900 tabular-nums">{n}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </Card>
        ))}
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {failed.length > 0 && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="bash-not-filed">
          <p className="font-semibold">
            {failed.length} of {plural(tried.length)} didn&apos;t go to {jiraConnected ? "Jira" : "the bug list"}
          </p>
          Nothing is lost. Press <b>File this bug…</b> to fix it, or wrap up now and file it later from the report.
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Review {plural(bugs.length)}</h2>
          {bugs.length > 0 && <span className="mr-auto text-xs text-slate-500">Untick a bug to leave it out</span>}
          <Button
            size="sm"
            className={cx(bugs.length === 0 && "ml-auto")}
            disabled={ticked.size < 2 || pending}
            onClick={() =>
              start(async () => {
                const r = await mergeBashItems([...ticked]);
                if (!r.ok) return setError(r.error);
                setTicked(new Set());
                router.refresh();
              })
            }
          >
            Merge selected
          </Button>
        </div>
        {bugs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No bugs were logged. Wrap up to save everyone&apos;s notes and close the run.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <span className="sr-only">Select to merge</span>
                  </th>
                  <th className="px-3 py-2 font-medium">File it</th>
                  <th className="px-3 py-2 font-medium">Bug</th>
                  <th className="px-3 py-2 font-medium">Area</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Seen by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bugs.map((b) => {
                  const left = b.review === "skip" && !b.bug;
                  return (
                    <tr key={b.id} className={cx(left && "text-slate-400")}>
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Select ${b.text} to merge`} disabled={!!b.bug} checked={ticked.has(b.id)} onChange={(e) => setTicked((t) => { const n = new Set(t); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {b.bug ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">
                            Filed · <span className="font-mono">{b.bug.externalKey ?? `D-${b.bug.number}`}</span>
                          </span>
                        ) : (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-slate-700">
                            <input type="checkbox" className="size-4 accent-accent-600" checked={b.review === "file"} disabled={pending} onChange={(e) => review(b.id, { review: e.target.checked ? "file" : "skip" })} aria-label={`File ${b.text}`} />
                            File it
                          </label>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="block">
                          {b.text}
                          {(left || b.fileError) && !b.bug && <UnfiledTag left={left} why={b.fileError} />}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {[b.attachments.length && `${b.attachments.length} ${b.attachments.length === 1 ? "file" : "files"}`, b.details && "has details"].filter(Boolean).join(" · ") || "Only one line"}
                        </span>
                        {b.fileError && !b.bug && !left && (
                          <span className="mt-1 block">
                            <FileBashBug bug={b} projectId={bash.runProjectId} entryId={bash.entryOf[b.areaId] ?? null} jiraConnected={jiraConnected} />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{areaName(b.areaId)}</td>
                      <td className="px-3 py-2">
                        <select aria-label={`Severity of ${b.text}`} disabled={!!b.bug} value={b.severity} onChange={(e) => review(b.id, { severity: e.target.value as BashSeverity })} className="h-7 rounded border border-slate-300 bg-surface px-1 text-xs">
                          {BASH_SEVERITIES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label} · {bash.sevNames[s.id]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {b.byName}
                        {b.plusOnes.length > 0 && <span className="text-slate-500" title={b.plusOnes.map((p) => p.name).join(", ")}> +{b.plusOnes.length}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <p className="mr-auto flex items-center gap-1.5 text-xs text-slate-500">
            Everyone&apos;s notes, questions and ideas are saved as their session on the area&apos;s charter.
            <InfoTip text="Under the hood the bash is a test run. It shows on Test runs and Reports, and stays out of release status unless someone turns on Include bug bashes there." />
          </p>
          {failed.length > 0 ? (
            <Button variant="primary" disabled={pending} onClick={() => wrap(true)}>
              {pending ? "Wrapping up…" : "Wrap up anyway"}
            </Button>
          ) : (
            <Button variant="primary" disabled={pending} onClick={() => wrap(false)}>
              {label}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/** "🐞 Bug bash live · 38 min left · Join": in the top bar and on the Umbrellas page while a bash runs. */
export function LiveBashPill({ href, endsAt, compact }: { href: string; endsAt: string; compact?: boolean }) {
  const left = useSecondsLeft(endsAt);
  if (left === null || left <= 0) return null;
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-red-700" data-testid="live-bash-pill">
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-white" />
      🐞 Bug bash live{!compact && ` · ${Math.ceil(left / 60)} min left`} · Join
    </Link>
  );
}
