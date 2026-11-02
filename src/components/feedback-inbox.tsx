"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, isOpenStatus, kindLabel, statusLabel } from "@/lib/feedback";
import { deleteFeedback, feedbackToBug, replyToFeedback, seenFeedback, setFeedbackStatus } from "@/server/feedback";
import { Badge, Button, cx, EmptyState, Input, Select, Textarea, type Tone } from "./ui";

export type FeedbackRow = {
  id: string;
  kind: string;
  message: string;
  place: string;
  path: string;
  area: string;
  appVersion: string;
  browser: string;
  from: string;
  firstName: string;
  mine: boolean;
  /** Sent without a name: nobody can get a reply. */
  anonymous: boolean;
  status: string;
  unseen: boolean;
  bugHref: string;
  when: string;
  shots: string[];
  replies: { id: string; who: string; text: string; when: string }[];
};

const KIND_TONE: Record<string, Tone> = { broken: "red", confusing: "orange", idea: "blue", like: "green" };
const STATUS_TONE: Record<string, Tone> = { new: "violet", looking: "gray", planned: "teal", done: "green", wontdo: "gray" };

/** The Feedback page: filters, the list on the left, the one you picked on the right. */
export function FeedbackInbox({ items, admin, everyone, projects }: { items: FeedbackRow[]; admin: boolean; everyone: boolean; projects: { id: string; key: string; name: string }[] }) {
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("all");
  const [area, setArea] = useState("all");
  const [q, setQ] = useState("");
  const areas = useMemo(() => [...new Set(items.map((i) => i.area))].sort(), [items]);
  const shown = items.filter(
    (i) =>
      (status === "all" || (status === "open" ? isOpenStatus(i.status) : i.status === status)) &&
      (kind === "all" || i.kind === kind) &&
      (area === "all" || i.area === area) &&
      (!q.trim() || `${i.message} ${i.place} ${i.from} ${i.replies.map((r) => r.text).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const current = shown.find((i) => i.id === picked) ?? shown[0] ?? null;

  return (
    <div className="space-y-4">
      {admin && (
        <nav aria-label="Whose feedback" className="flex gap-1 border-b border-slate-200">
          <TabLink href="/feedback" on={everyone}>
            Everyone&apos;s feedback
          </TabLink>
          <TabLink href="/feedback?view=yours" on={!everyone}>
            Yours
          </TabLink>
        </nav>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Filter label="Status" value={status} onChange={setStatus} options={[{ id: "open", label: "Open" }, { id: "all", label: "All" }, ...FEEDBACK_STATUSES]} />
        <Filter label="Kind" value={kind} onChange={setKind} options={[{ id: "all", label: "All" }, ...FEEDBACK_KINDS]} />
        <Filter label="Where" value={area} onChange={setArea} options={[{ id: "all", label: "All areas" }, ...areas.map((a) => ({ id: a, label: a }))]} />
        <label className="flex flex-col text-xs font-medium text-slate-600">
          Search
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words in the feedback" className="mt-1 w-56" />
        </label>
      </div>
      {!items.length ? (
        <EmptyState title={everyone ? "No feedback yet" : "You haven't sent any feedback yet"}>Press Feedback at the top of any page to send some. You can take a screenshot and circle what you mean.</EmptyState>
      ) : !shown.length ? (
        <p className="text-sm text-slate-500">Nothing matches these filters.</p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ul className="flex w-full flex-col gap-2 lg:w-96 lg:shrink-0" aria-label="Feedback">
            {shown.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setPicked(i.id)}
                  aria-current={current?.id === i.id}
                  className={cx("flex w-full gap-3 rounded-lg border bg-surface p-3 text-left hover:border-accent-500", current?.id === i.id ? "border-accent-600 ring-1 ring-accent-600" : "border-slate-200")}
                >
                  {i.shots.length ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/feedback-shots/${i.shots[0]}`} alt="" className="h-12 w-18 shrink-0 rounded border border-slate-200 object-cover" />
                  ) : (
                    <span aria-hidden className="h-12 w-18 shrink-0 rounded border border-dashed border-slate-300" />
                  )}
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={KIND_TONE[i.kind]}>{kindLabel(i.kind)}</Badge>
                      <Badge tone={STATUS_TONE[i.status]}>{statusLabel(i.status)}</Badge>
                      {i.unseen && <span className="text-xs font-medium text-red-600">New reply</span>}
                    </span>
                    <span className="line-clamp-2 text-sm text-slate-800">{i.message || "(a picture, no note)"}</span>
                    <span className="text-xs text-slate-500">
                      {i.area} · {i.from} · {i.when}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current && <Detail key={current.id} i={current} admin={admin} projects={projects} />}
        </div>
      )}
    </div>
  );
}

function TabLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", on ? "border-accent-600 font-semibold text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
      {children}
    </Link>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly { id: string; label: string }[] }) {
  return (
    <label className="flex flex-col text-xs font-medium text-slate-600">
      {label}
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-auto">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function Detail({ i, admin, projects }: { i: FeedbackRow; admin: boolean; projects: { id: string; key: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [bugOpen, setBugOpen] = useState(false);
  const [bugProject, setBugProject] = useState(projects[0]?.id ?? "");
  const [bugTitle, setBugTitle] = useState(() => (i.message.split("\n")[0] || kindLabel(i.kind)).slice(0, 120));

  // Opening your own feedback with a new reply clears the dot on Feedback.
  useEffect(() => {
    if (i.unseen) void seenFeedback(i.id).then(() => router.refresh());
  }, [i.id, i.unseen, router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError("");
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      after?.();
      router.refresh();
    });

  // Feedback sent without a name can't be answered: nobody would see the reply.
  const canReply = i.mine || (admin && !i.anonymous);
  const replyTo = i.mine ? "Add to your feedback" : i.firstName ? `Reply to ${i.firstName}` : "Reply";
  return (
    <section aria-label="Feedback details" className="min-w-0 flex-1 space-y-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          {kindLabel(i.kind)} · {i.area}
        </h2>
        {admin ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Status
            <Select value={i.status} disabled={pending} onChange={(e) => run(() => setFeedbackStatus(i.id, e.target.value))} className="w-auto">
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <Badge tone={STATUS_TONE[i.status]}>{statusLabel(i.status)}</Badge>
        )}
      </div>
      {i.message && <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800">{i.message}</p>}
      {i.shots.map((id, n) => (
        <a key={id} href={`/api/feedback-shots/${id}`} target="_blank" rel="noreferrer" className="block" title="Open full size">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/feedback-shots/${id}`} alt={`Picture ${n + 1} sent with the feedback`} className="max-h-96 w-auto max-w-full rounded border border-slate-300" />
        </a>
      ))}
      <p className="text-xs text-slate-500">
        {i.path ? (
          <Link href={i.path} className="text-accent-700 underline">
            Open where it was sent
          </Link>
        ) : (
          "Sent"
        )}
        {i.place && <> ({i.place})</>} · {i.from} · {i.when} · Flaw Patrol {i.appVersion}
        {i.browser && <> · {i.browser}</>}
      </p>
      {i.bugHref && (
        <p className="text-sm">
          <Link href={i.bugHref} className="text-accent-700 underline">
            Turned into a bug: see it on the Bugs page
          </Link>
        </p>
      )}
      {i.replies.length > 0 && (
        <ol className="space-y-2" aria-label="Replies">
          {i.replies.map((r) => (
            <li key={r.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              <p className="text-xs text-slate-500">
                {r.who} · {r.when}
              </p>
              <p className="whitespace-pre-wrap text-slate-800">{r.text}</p>
            </li>
          ))}
        </ol>
      )}
      {canReply && (
        <div className="space-y-2">
          <label htmlFor="feedback-reply" className="block text-sm font-medium text-slate-800">
            {replyTo}
          </label>
          <Textarea id="feedback-reply" rows={2} value={reply} maxLength={5000} onChange={(e) => setReply(e.target.value)} placeholder={i.mine ? "Anything else to add?" : "They'll see a dot on Feedback at the top of the page."} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canReply && (
          <Button variant="primary" disabled={pending || !reply.trim()} onClick={() => run(() => replyToFeedback(i.id, reply), () => setReply(""))}>
            Send reply
          </Button>
        )}
        {admin && !i.bugHref && projects.length > 0 && (
          <Button onClick={() => setBugOpen((o) => !o)} aria-expanded={bugOpen}>
            Turn into a bug
          </Button>
        )}
        {admin && (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this feedback, its pictures and replies? This can't be undone.")) run(() => deleteFeedback(i.id));
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {bugOpen && (
        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="feedback-bug">
          <p className="text-sm text-slate-700">Saves a bug on a test cycle&apos;s Bugs page, with the note, where it was sent from and the pictures.</p>
          <label className="block text-xs font-medium text-slate-600">
            Test cycle
            <Select value={bugProject} onChange={(e) => setBugProject(e.target.value)} className="mt-1 w-auto max-w-full">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Summary
            <Input value={bugTitle} maxLength={300} onChange={(e) => setBugTitle(e.target.value)} className="mt-1" />
          </label>
          <Button variant="primary" disabled={pending || !bugTitle.trim()} onClick={() => run(() => feedbackToBug(i.id, bugProject, bugTitle), () => setBugOpen(false))}>
            Save the bug
          </Button>
        </div>
      )}
    </section>
  );
}
