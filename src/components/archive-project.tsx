"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { archiveProjects, setArchived } from "@/server/projects";
import { setUmbrellaArchived } from "@/server/umbrella";
import { Button, Card, cx, ErrorText, InfoTip } from "./ui";

/** Shown on every page of an archived project. */
export function ArchivedBanner({ projectKey, canRestore }: { projectKey: string; canRestore: boolean }) {
  return (
    <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      This test cycle is archived. It&apos;s tucked away under Archived on the Umbrellas page, and everything in it still works.
      {canRestore && (
        <>
          {" "}
          <Link href={`/p/${projectKey}/settings#archive`} className="font-medium underline">
            Restore it
          </Link>
        </>
      )}
    </p>
  );
}

/** Shown on every page of an archived umbrella and the projects archived with it. */
export function UmbrellaArchivedBanner({ groupId, name, canRestore }: { groupId: string; name: string; canRestore: boolean }) {
  return (
    <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {name} is archived, with its test cycles. It&apos;s tucked away in the Archived fold on the Umbrellas page, and everything in it still opens.
      {canRestore && (
        <>
          {" "}
          <Link href={`/g/${groupId}/settings`} className="font-medium underline">
            Restore {name}
          </Link>
        </>
      )}
    </p>
  );
}

export type ArchiveCardData = {
  /** The test cycle whose Settings this is; null on the umbrella's own settings. */
  current: { id: string; name: string; archived: boolean } | null;
  umbrella: {
    id: string;
    name: string;
    archived: boolean;
    /** Admins of the umbrella may archive or restore all of it. */
    canArchive: boolean;
    /** What goes with the whole umbrella (or comes back with a restore). */
    going: string[];
    /** Live test cycles the viewer may archive, newest first. */
    cycles: { id: string; name: string; openRuns: number; activity: string }[];
  } | null;
};

/** Sent with a test cycle's id to open the umbrella's Archive card with it ticked. */
export const ARCHIVE_CYCLE_EVENT = "fp:archive-cycle";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "OKO Web RC23" under OKO reads "Web RC23"; the full name stays on hover. */
const trim = (name: string, umbrella: string) => (name.startsWith(`${umbrella} `) ? name.slice(umbrella.length + 1) : name);

/** The red in-card question before anything is archived; Cancel always visible. */
function Confirm({ question, yes, onYes, onNo, pending, tone = "danger" }: { question: string; yes: string; onYes: () => void; onNo: () => void; pending: boolean; tone?: "danger" | "accent" }) {
  return (
    <div className={tone === "danger" ? "space-y-2 rounded-md border border-red-300 bg-red-50 p-3" : "space-y-2 rounded-md border border-accent-200 bg-accent-50 p-3"} role="group" aria-label="Confirm">
      <p className="text-sm font-semibold text-slate-900">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tone === "danger" ? "danger" : "primary"} disabled={pending} onClick={onYes} className={tone === "danger" ? "border-red-600 bg-red-600 text-white hover:bg-red-700" : undefined}>
          {yes}
        </Button>
        <Button size="sm" onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The one Archive… card at the bottom of Settings (each test cycle's, and the
 * umbrella's). Inside an umbrella it asks what to archive: test cycles (the
 * default, from a tick list) or the whole umbrella. Confirms happen in the card.
 */
export function ArchiveCard({ data }: { data: ArchiveCardData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"cycles" | "umbrella">("cycles");
  const [asking, setAsking] = useState<null | "archive" | "restore-cycle" | "restore-umbrella" | "archive-one">(null);
  const { current, umbrella } = data;
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(current && !current.archived ? [current.id] : []));
  // ⋯ → Archive… on a Test cycles row (ver_117) opens this card with that test cycle ticked.
  useEffect(() => {
    const pick = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setOpen(true);
      setMode("cycles");
      setAsking(null);
      setTicked(new Set([id]));
      requestAnimationFrame(() => document.getElementById("archive")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };
    window.addEventListener(ARCHIVE_CYCLE_EVENT, pick);
    return () => window.removeEventListener(ARCHIVE_CYCLE_EVENT, pick);
  }, []);
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setError(null);
      setAsking(null);
      setOpen(false);
      router.refresh();
    });
  const tip = "Archived things move to the Archived fold on the Umbrellas page for everyone. Cases, suites, runs, bugs and reports all stay. Nothing is deleted, and Restore brings it back.";
  const heading = (
    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
      Archive <InfoTip text={tip} />
    </h2>
  );

  // A test cycle outside any umbrella: archive or restore just this one.
  if (!umbrella) {
    if (!current) return null;
    return (
      <Card id="archive" className="space-y-3 p-5" data-testid="archive-card">
        {heading}
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {current.archived && <p className="text-sm text-slate-600">This test cycle is in the Archived fold on the Umbrellas page.</p>}
        {asking ? (
          <Confirm
            question={current.archived ? `Restore ${current.name}?` : `Archive ${current.name}?`}
            yes={current.archived ? "Yes, restore" : "Yes, archive"}
            tone={current.archived ? "accent" : "danger"}
            pending={pending}
            onYes={() => act(() => setArchived(current.id, !current.archived))}
            onNo={() => setAsking(null)}
          />
        ) : (
          <Button onClick={() => setAsking("archive-one")}>{current.archived ? "Restore…" : "Archive…"}</Button>
        )}
      </Card>
    );
  }

  const n = umbrella.going.length;
  // The whole umbrella is archived: only its admins can bring it back.
  if (umbrella.archived) {
    return (
      <Card id="archive" className="space-y-3 p-5" data-testid="archive-card">
        {heading}
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {umbrella.name} is archived. It&apos;s in the Archived fold on the Umbrellas page.
        </p>
        {umbrella.canArchive &&
          (asking === "restore-umbrella" ? (
            <Confirm
              question={`Restore ${umbrella.name}${n ? ` and its ${plural(n, "test cycle")}` : ""}?`}
              yes="Yes, restore"
              tone="accent"
              pending={pending}
              onYes={() => act(() => setUmbrellaArchived(umbrella.id, false))}
              onNo={() => setAsking(null)}
            />
          ) : (
            <Button onClick={() => setAsking("restore-umbrella")}>Restore…</Button>
          ))}
      </Card>
    );
  }

  const picked = umbrella.cycles.filter((c) => ticked.has(c.id));
  const word = plural(picked.length, "test cycle");
  return (
    <Card id="archive" className="space-y-3 p-5" data-testid="archive-card">
      {heading}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {current?.archived && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">This test cycle is archived. It stays out of {umbrella.name}&apos;s menus until it&apos;s restored.</p>
          {asking === "restore-cycle" ? (
            <Confirm question={`Restore ${current.name}?`} yes="Yes, restore" tone="accent" pending={pending} onYes={() => act(() => setArchived(current.id, false))} onNo={() => setAsking(null)} />
          ) : (
            <Button onClick={() => setAsking("restore-cycle")}>Restore this test cycle…</Button>
          )}
        </div>
      )}
      {(umbrella.cycles.length > 0 || umbrella.canArchive) && (
        <div>
          <Button aria-expanded={open} onClick={() => (setOpen(!open), setAsking(null))}>
            Archive…
          </Button>
        </div>
      )}
      {open && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {umbrella.canArchive && (
            <div role="radiogroup" aria-label="What to archive" className="inline-flex flex-wrap overflow-hidden rounded-md border border-slate-300 bg-surface text-sm">
              {(
                [
                  ["cycles", "Test cycles"],
                  ["umbrella", `The whole ${umbrella.name} umbrella`],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={mode === v}
                  onClick={() => (setMode(v), setAsking(null))}
                  className={cx("px-3 py-1.5", mode === v ? "bg-accent-600 text-white" : "text-slate-700 hover:bg-slate-100")}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {mode === "cycles" ? (
            <>
              <p className="text-xs text-slate-500">Pick the test cycles you&apos;re done with. {umbrella.name} and its other test cycles stay.</p>
              {umbrella.cycles.length ? (
                <ul className="space-y-1.5" aria-label="Test cycles to archive">
                  {umbrella.cycles.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={ticked.has(c.id)}
                          onChange={(e) =>
                            setTicked((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 font-medium text-slate-900">
                          {c.name}
                          {c.openRuns > 0 && (
                            <span title="Has an open run. Archiving keeps the run as it is." className="ml-1.5 cursor-help text-amber-600">
                              ⚠
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-slate-500">
                          {c.openRuns ? plural(c.openRuns, "open run") : "No open runs"} · {c.activity}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No test cycles left to archive.</p>
              )}
              {asking === "archive" ? (
                <Confirm
                  question={`Archive ${word}? They move to Archived for everyone.`}
                  yes={`Yes, archive ${picked.length}`}
                  pending={pending}
                  onYes={() => act(() => archiveProjects(picked.map((c) => c.id)))}
                  onNo={() => setAsking(null)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={!picked.length} onClick={() => setAsking("archive")}>
                    Archive {word}
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                {umbrella.name}, its case library and every test cycle in it move to Archived together. Goes with it: {plural(n, "test cycle")}.
              </p>
              {n > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Goes with it">
                  {umbrella.going.map((name) => (
                    <li key={name} title={name} className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
                      {trim(name, umbrella.name)}
                    </li>
                  ))}
                </ul>
              )}
              {asking === "archive" ? (
                <Confirm
                  question={`Archive ${umbrella.name}${n ? ` and its ${plural(n, "test cycle")}` : ""}?`}
                  yes="Yes, archive"
                  pending={pending}
                  onYes={() => act(() => setUmbrellaArchived(umbrella.id, true))}
                  onNo={() => setAsking(null)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setAsking("archive")}>
                    Archive umbrella…
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
