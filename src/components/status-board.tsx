"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime } from "@/lib/format";
import { groupCards, summaryLine, writeBugHref, type SentryBoard, type StatusCard, type StatusDot, type StatusSource } from "@/lib/status-cards";
import { statusCheck, statusSummary } from "@/server/status";
import { Button, Card, cx } from "./ui";

// Status (ver_228): one card per connected build or tool. Each card asks its tool on its own,
// so a slow TeamCity never holds up GitHub. Red first, then all good, then can't reach.

type Slot = { card: StatusCard | null; error: string | null };

export function StatusBoard({ groupId, name, sources, canManage, canBug }: { groupId: string; name: string; sources: StatusSource[]; canManage: boolean; canBug: boolean }) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const round = useRef(0);

  const load = useCallback(
    (fresh: boolean) => {
      const mine = ++round.current;
      setBusy(true);
      if (fresh) setSlots({});
      let left = sources.length;
      if (!left) setBusy(false);
      for (const s of sources)
        void statusCheck(groupId, s.key, fresh)
          .then((r) => {
            if (mine !== round.current) return;
            setSlots((cur) => ({ ...cur, [s.key]: r.ok ? { card: r.card, error: null } : { card: null, error: r.error } }));
          })
          .catch(() => {
            if (mine === round.current) setSlots((cur) => ({ ...cur, [s.key]: { card: null, error: "Couldn't check. Press Refresh to try again." } }));
          })
          .finally(() => {
            if (mine === round.current && --left === 0) setBusy(false);
          });
    },
    [groupId, sources],
  );
  useEffect(() => load(false), [load]);
  // "Checked 2 min ago" keeps counting while the page is open.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // A card whose check failed outright reads as can't reach.
  const cards: StatusCard[] = sources.flatMap((s) => {
    const slot = slots[s.key];
    if (!slot) return [];
    return [slot.card ?? { ...s, state: "off" as const, pill: "Can't check", line: slot.error ?? "Couldn't check.", checkedAt: new Date().toISOString() }];
  });
  const waiting = sources.filter((s) => !slots[s.key]);
  const { bad, good, off } = groupCards(cards);
  const oldest = cards.length ? Math.min(...cards.map((c) => Date.parse(c.checkedAt))) : null;
  const checked = oldest === null ? "" : relativeTime(new Date(oldest)) === "just now" ? "Checked just now" : `Checked ${relativeTime(new Date(oldest))}`;
  const settings = `/g/${groupId}/settings`;

  if (!sources.length)
    return (
      <div className="page page-list">
        <Header name={name} checked="" busy={false} onRefresh={null} />
        <Card className="space-y-3 p-6 text-sm text-slate-700" data-testid="status-empty">
          <p className="font-medium text-slate-900">Nothing is connected yet.</p>
          <p>Status shows how your builds and tools are doing, all in one place: GitHub workflow runs, TeamCity builds, new Sentry errors in the builds you&apos;re testing, and results your pipeline uploads.</p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {[
                ["GitHub", "github"],
                ["TeamCity", "teamcity"],
                ["Sentry", "sentry"],
                ["CI uploads", "ci-uploads"],
              ].map(([label, hash]) => (
                <Link key={hash} href={`${settings}#${hash}`} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-surface px-3.5 text-sm text-slate-800 shadow-sm hover:bg-slate-50">
                  Connect {label}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-slate-600">An Admin can connect GitHub, TeamCity, Sentry or CI uploads in Settings.</p>
          )}
        </Card>
      </div>
    );

  return (
    <div className="page page-list">
      <Header name={name} checked={checked} busy={busy} onRefresh={() => load(true)} />
      <p
        className={cx("mb-4 rounded-lg px-4 py-2.5 text-sm font-semibold", waiting.length && !bad.length ? "bg-slate-100 text-slate-700" : bad.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800")}
        role="status"
        data-testid="status-summary"
        data-howto="status-summary"
      >
        {waiting.length && !bad.length ? `Checking ${waiting.length === sources.length ? "everything" : `${waiting.length} more`}…` : summaryLine(bad.length)}
      </p>

      {bad.length > 0 && (
        <section aria-labelledby="st-bad" className="mb-6">
          <h2 id="st-bad" className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Needs a look
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {bad.map((c) => (
              <BigCard key={c.key} c={c} groupId={groupId} canBug={canBug} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {(good.length > 0 || waiting.length > 0) && (
          <section aria-labelledby="st-good">
            <h2 id="st-good" className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              All good
            </h2>
            <Card className="divide-y divide-slate-100">
              {good.map((c) => (
                <OkRow key={c.key} c={c} groupId={groupId} canBug={canBug} />
              ))}
              {waiting.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-slate-500">
                  <span>{s.title}</span>
                  <span className="text-xs">Checking…</span>
                </div>
              ))}
            </Card>
          </section>
        )}
        {off.length > 0 && (
          <section aria-labelledby="st-off">
            <h2 id="st-off" className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Can&apos;t reach
            </h2>
            <div className="space-y-3">
              {off.map((c) => (
                <Card key={c.key} className="space-y-1.5 p-4" data-testid={`status-card-${c.key}`}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{c.title}</h3>
                    <Pill c={c} />
                  </div>
                  <p className="text-sm text-slate-700">{c.line}</p>
                  {canManage && c.fix && (
                    <Link href={`${settings}#${c.fix}`} className="text-sm font-medium text-accent-700 underline hover:no-underline">
                      Fix it in Settings
                    </Link>
                  )}
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Header({ name, checked, busy, onRefresh }: { name: string; checked: string; busy: boolean; onRefresh: (() => void) | null }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Status</h1>
        <p className="mt-1 text-sm text-slate-500">
          GitHub, TeamCity, Sentry and CI uploads for {name}
          {checked && <span data-testid="status-checked"> · {checked}</span>}
        </p>
      </div>
      {onRefresh && (
        <Button onClick={onRefresh} disabled={busy} data-howto="status-refresh" data-testid="status-refresh">
          {busy ? "Checking…" : "Refresh"}
        </Button>
      )}
    </div>
  );
}

function Pill({ c }: { c: StatusCard }) {
  const tone = c.state === "bad" ? "bg-red-50 text-red-700 ring-red-200" : c.state === "good" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200";
  return <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1", tone)}>{c.pill}</span>;
}

/** Relative time; hover or tap shows the exact time in your own time zone. */
function When({ at }: { at: string }) {
  const [exact, setExact] = useState(false);
  const d = new Date(at);
  const full = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const clock = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <button type="button" title={full} onClick={() => setExact((v) => !v)} className="text-left underline decoration-dotted underline-offset-2 hover:text-slate-700">
      {exact ? full : relativeTime(d)}
      {!exact && <span className="hidden sm:inline"> ({clock})</span>}
    </button>
  );
}

const DOT_WORD: Record<StatusDot, string> = { pass: "passed", fail: "failed", other: "other" };

function Dots({ dots }: { dots: StatusDot[] }) {
  if (!dots.length) return null;
  const label = `Last ${dots.length} builds, newest on the right: ${dots.map((d) => DOT_WORD[d]).join(", ")}`;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center gap-1">
      {dots.map((d, i) => (
        <i key={i} className={cx("inline-block size-2.5 rounded-full", d === "pass" ? "bg-emerald-600" : d === "fail" ? "bg-red-600" : "bg-slate-400")} />
      ))}
    </span>
  );
}

function Meta({ c }: { c: StatusCard }) {
  const bits = [c.label, c.branch].filter(Boolean).join(" · ");
  if (!bits && !c.at && !c.dots?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span>
        {bits}
        {bits && c.at && " · "}
        {c.at && <When at={c.at} />}
      </span>
      {c.dots && <Dots dots={c.dots} />}
    </div>
  );
}

function BigCard({ c, groupId, canBug }: { c: StatusCard; groupId: string; canBug: boolean }) {
  return (
    <Card className="space-y-2 border-red-200 p-4" data-testid={`status-card-${c.key}`} data-howto="status-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900">{c.title}</h3>
        <Pill c={c} />
      </div>
      <p className="text-sm text-slate-800">{c.line}</p>
      <Meta c={c} />
      {c.sentry && <SentryRows s={c.sentry} groupId={groupId} canBug={canBug} />}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {c.open && (
          <a href={c.open.url} target="_blank" rel="noreferrer" className="font-medium text-accent-700 underline hover:no-underline">
            {c.open.label} ↗
          </a>
        )}
        {c.more && (
          <Link href={c.more.href} className="font-medium text-accent-700 underline hover:no-underline" data-howto={c.more.label === "Test health" ? "status-test-health" : undefined}>
            {c.more.label}
          </Link>
        )}
        {canBug && c.bug && (
          <Link href={writeBugHref(groupId, c.bug)} className="font-medium text-accent-700 underline hover:no-underline" data-testid="status-write-bug">
            Write a bug
          </Link>
        )}
      </div>
    </Card>
  );
}

function OkRow({ c, groupId, canBug }: { c: StatusCard; groupId: string; canBug: boolean }) {
  return (
    <div className="space-y-1 px-4 py-2.5" data-testid={`status-card-${c.key}`}>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="font-medium text-slate-900">{c.title}</span>
        <Pill c={c} />
      </div>
      <p className="text-xs text-slate-600">
        {c.line}
        {c.open && (
          <>
            {" "}
            <a href={c.open.url} target="_blank" rel="noreferrer" className="text-accent-700 underline hover:no-underline">
              {c.open.label} ↗
            </a>
          </>
        )}
        {c.more && (
          <>
            {" "}
            <Link href={c.more.href} className="text-accent-700 underline hover:no-underline" data-howto={c.more.label === "Test health" ? "status-test-health" : undefined}>
              {c.more.label}
            </Link>
          </>
        )}
      </p>
      <Meta c={c} />
      {c.sentry && <SentryRows s={c.sentry} groupId={groupId} canBug={canBug} />}
    </div>
  );
}

const ROW_TONE = { bad: "text-red-700", good: "text-emerald-800", quiet: "text-slate-600" } as const;

/** The Sentry card's builds (ver_258): one row per build being tested, then everything else in the last day. */
function SentryRows({ s, groupId, canBug }: { s: SentryBoard; groupId: string; canBug: boolean }) {
  const link = "font-medium text-accent-700 underline hover:no-underline";
  const elseRows = [
    { key: "other", name: "Other builds", hint: "not being tested", v: s.other },
    { key: "none", name: "No build", hint: "editor, dev machines", v: s.none },
  ].filter((r) => r.v);
  return (
    <div className="space-y-3 pt-1" data-testid="sentry-builds" data-howto="status-sentry-builds">
      {s.rows.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600">
            Builds you&apos;re testing <span className="font-normal text-slate-500">· tested in the last 7 days, or in a live bug bash</span>
          </p>
          <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200">
            {s.rows.map((r) => (
              <li key={r.build} className="space-y-0.5 px-3 py-2 text-sm" data-testid="sentry-build-row">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="font-medium break-all text-slate-900">Build {r.build}</span>
                    {r.platform && <span className="text-slate-600">· {r.platform}</span>}
                    {r.tags.map((t) => (
                      <span key={t} className={cx("rounded px-1.5 py-px text-xs font-semibold ring-1", t === "Bug bash" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-sky-50 text-sky-800 ring-sky-200")}>
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className={cx("text-xs font-semibold whitespace-nowrap", ROW_TONE[r.state])}>{r.pill}</span>
                </div>
                <p className="flex flex-wrap gap-x-2 text-xs text-slate-700">
                  {r.line && <span>{r.line}</span>}
                  {r.open && (
                    <a href={r.open.url} target="_blank" rel="noreferrer" className={link}>
                      {r.open.label} ↗
                    </a>
                  )}
                  {canBug && r.bug && (
                    <Link href={writeBugHref(groupId, r.bug)} className={link} data-testid="status-write-bug">
                      Write a bug
                    </Link>
                  )}
                </p>
                {r.sentryRelease && <p className="text-xs break-all text-slate-500">Sentry calls it {r.sentryRelease}</p>}
              </li>
            ))}
          </ul>
          {s.more > 0 && <p className="mt-1 text-xs text-slate-500">and {s.more} more {s.more === 1 ? "build" : "builds"} being tested</p>}
        </div>
      )}
      {elseRows.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600">Everything else, last day</p>
          <ul className="mt-1 space-y-1">
            {elseRows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-700" data-testid={`sentry-${r.key}`}>
                <span>
                  <span className="font-medium text-slate-900">{r.name}</span> <span className="text-slate-500">({r.hint})</span>
                </span>
                <span>
                  {r.v!.count >= 100 ? "100+" : r.v!.count} {r.v!.count === 1 ? "error" : "errors"} ·{" "}
                  <a href={r.v!.url} target="_blank" rel="noreferrer" className={link}>
                    See them in Sentry ↗
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.missing && (
        <p className="text-xs text-slate-600" data-testid="sentry-missing">
          The newest {s.missing.name} has no build, so it&apos;s left out{s.missing.others > 0 ? ` (and ${s.missing.others} more ${s.missing.others === 1 ? "run" : "runs"})` : ""}.{" "}
          <Link href={s.missing.href} className={link}>
            Add its build
          </Link>
        </p>
      )}
    </div>
  );
}

/** Overview's one line: "2 things need a look · Open Status". Hidden when nothing is connected. */
export function StatusLine({ groupId }: { groupId: string }) {
  const [sum, setSum] = useState<{ total: number; bad: number } | null>(null);
  useEffect(() => {
    void statusSummary(groupId).then((r) => r.ok && setSum({ total: r.total, bad: r.bad }));
  }, [groupId]);
  if (!sum || !sum.total) return null;
  return (
    <p className={cx("mb-4 flex flex-wrap items-center gap-x-2 rounded-lg border px-4 py-2.5 text-sm", sum.bad ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")} data-testid="overview-status">
      <span className="font-semibold">{summaryLine(sum.bad)}</span>
      <span aria-hidden>·</span>
      <Link href={`/g/${groupId}/status`} className="font-medium text-accent-700 underline hover:no-underline">
        Open Status
      </Link>
    </p>
  );
}
