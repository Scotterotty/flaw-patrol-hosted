"use client";

import type { Role } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { andList, MEMBER_ACCESS } from "@/lib/link-access";
import { ROLE_LABEL, ROLES_PICK } from "@/lib/permissions";
import { answerJoinRequest, askToJoin, cancelJoinRequest } from "@/server/join-requests";
import { Avatar } from "./avatar";
import { Button, buttonClass, ErrorText, Select } from "./ui";

// Ask to join (ver_115): the buttons on "You're not on this team yet", the home page's
// "Waiting to join", and the requests at the top of Settings → Members.

/** "Demo Admin and Dana Lead will see it." */
const whoSees = (admins: string[]) => (admins.length ? `${andList(admins)} will see it` : "The team's admins will see it");

export function AskToJoin({ path, admins, requestId }: { path: string; admins: string[]; requestId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Failed"));
      router.refresh();
    });
  if (requestId)
    return (
      <div className="mt-4 space-y-3">
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Request sent. {whoSees(admins)}. You&apos;ll get access as soon as {admins.length === 1 ? "they say" : "one of them says"} yes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className={buttonClass("primary")}>
            Go to my home page
          </Link>
          <Button variant="ghost" disabled={pending} onClick={() => act(() => cancelJoinRequest(requestId))}>
            Cancel request
          </Button>
        </div>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      </div>
    );
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending} onClick={() => act(() => askToJoin(path))}>
          {pending ? "Asking…" : "Ask to join"}
        </Button>
        <Link href="/" className={buttonClass("secondary")}>
          Go to my home page
        </Link>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}

/** One "Waiting to join X" card on the home page of someone not on any team yet. */
export function WaitingToJoin({ request }: { request: { id: string; team: string; at: string; admins: string[] } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
      <p className="font-medium text-slate-900">Waiting to join {request.team}</p>
      <p className="mt-1 text-sm text-slate-600" suppressHydrationWarning>
        You asked {relativeTime(new Date(request.at))}. {request.admins.length ? andList(request.admins) : "The team's admins"} will see your request, and this page updates when {request.admins.length === 1 ? "they add" : "one of them adds"} you.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        New here? Whoever invited you can also send you an invite link from <span className="font-medium">Settings → Members</span>.
      </p>
      <Button
        className="mt-3"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await cancelJoinRequest(request.id);
            router.refresh();
          })
        }
      >
        Cancel request
      </Button>
    </div>
  );
}

export type JoinRequestRow = { id: string; userId: string; name: string | null; email: string; avatarAt: Date | null; what: string; at: string };

/** At the top of Members for admins: who wants in, a role, and Add or Ignore. */
export function JoinRequests({ requests, team }: { requests: JoinRequestRow[]; team: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  if (!requests.length) return null;
  const answer = (id: string, add: boolean) =>
    start(async () => {
      const r = await answerJoinRequest(id, { add, role: roles[id] ?? "TESTER" });
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  return (
    <section aria-label="Asking to join" className="mt-3 mb-2 space-y-2">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {requests.map((q) => (
        <div key={q.id} className="flex flex-wrap items-center gap-3 rounded-md border border-accent-200 bg-accent-50/60 px-3 py-2">
          <Avatar person={{ id: q.userId, name: q.name, email: q.email, avatarAt: q.avatarAt }} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">
              {q.what === MEMBER_ACCESS ? `${q.name ?? q.email} is a Viewer and asks for Member access in ${team}` : `${q.name ?? q.email} wants to join ${team}`}
            </p>
            <p className="truncate text-xs text-slate-500" suppressHydrationWarning>
              {[q.name && q.email, q.what && q.what !== MEMBER_ACCESS && `opened ${q.what} link`, relativeTime(new Date(q.at))].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Select aria-label={`Role for ${q.email}`} className="h-8 w-auto max-w-full text-xs" value={roles[q.id] ?? "TESTER"} disabled={pending} onChange={(e) => setRoles((r) => ({ ...r, [q.id]: e.target.value as Role }))}>
            {ROLES_PICK.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => answer(q.id, true)}>
            Add
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => answer(q.id, false)}>
            Ignore
          </Button>
        </div>
      ))}
    </section>
  );
}

/** On a bug bash's Join page for someone outside the team: what this is and what they'll see. */
export function BashGuestNote({ team, startedBy, people, bugs, askHref }: { team: string; startedBy: string; people: number; bugs: number; askHref: string }) {
  return (
    <div className="mx-auto mb-5 max-w-2xl rounded-lg border border-slate-200 bg-surface px-4 py-3 text-center text-sm text-slate-600 shadow-sm">
      <p>
        {startedBy} started this bug bash in <span className="font-medium text-slate-800">{team}</span>. {people === 1 ? "1 person is" : `${people} people are`} exploring, and {bugs === 1 ? "1 bug is" : `${bugs} bugs are`} logged so far.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        You&apos;ll see this bug bash only. To see the rest of {team},{" "}
        <Link href={askHref} className="font-medium text-accent-700 hover:underline">
          ask to join the team
        </Link>
        .
      </p>
    </div>
  );
}
