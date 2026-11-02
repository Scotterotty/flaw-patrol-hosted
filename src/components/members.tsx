"use client";

import { useZone } from "./spelling";

import { Fragment, type ReactNode } from "react";
import type { Role } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ROLE_LABEL, ROLES_PICK } from "@/lib/permissions";
import { relativeTime } from "@/lib/format";
import { linkUntil } from "@/lib/invite-message";
import { copyInviteLink, createPasswordLink, emailPasswordLink, sendInvite } from "@/server/passwords";
import { addMember, changeRole, removeMember, updateProject } from "@/server/projects";
import { Avatar } from "./avatar";
import { JoinRequests, type JoinRequestRow } from "./join-request";
import { RoleBadge } from "./badges";
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from "./ui";

type Member = { userId: string; email: string; name: string | null; role: Role; signedIn: boolean; hasPassword: boolean; avatarAt: Date | null; inviteSentAt?: Date | null; inviteUntil?: Date | null; title: string | null; frame: string | null };


export function MembersPanel({ projectId, members, canManage, me, canEmail = false, nudge, requests = [], team = "" }: { projectId: string; members: Member[]; canManage: boolean; me: string; canEmail?: boolean; nudge?: ReactNode; requests?: JoinRequestRow[]; team?: string }) {
  const router = useRouter();
  const zone = useZone();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("TESTER");
  const [link, setLink] = useState<{ userId: string; url: string; hours: number } | null>(null);
  const [inviteLink, setInviteLink] = useState<{ userId: string; message: string } | null>(null);
  const [invited, setInvited] = useState<{ email: string; role: Role; hasPassword: boolean; failed: boolean; message: string | null } | null>(null);
  const [sendIt, setSendIt] = useState(true);
  const [sent, setSent] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Failed"));
      if (res.ok) after?.();
      router.refresh();
    });

  return (
    <Card id="members" className="scroll-mt-20 p-5">
      <h2 className="text-sm font-semibold text-slate-800">Members</h2>
      {/* The Roles row is the one place that says what each role can do, so it stays right when presets change (ver_89). */}
      {canManage && (
        <p className="mt-1 mb-4 text-xs">
          <a href="#roles" className="font-medium text-accent-700 hover:underline">
            What each role can do →
          </a>
        </p>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {/* Ask to join (ver_115): people who opened a link here and asked, on top for admins. */}
      {canManage && <JoinRequests requests={requests} team={team} />}
      <ul className="mt-2 divide-y divide-slate-100">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2">
            <Avatar person={{ id: m.userId, name: m.name, email: m.email, avatarAt: m.avatarAt, frame: m.frame }} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">
                {m.name ?? m.email}
                {m.title && <span className="font-normal text-slate-500"> · {m.title}</span>} {m.userId === me && <span className="text-xs font-normal text-slate-400">(you)</span>}
              </p>
              {/* Dates are shown in the viewer's time zone, which can differ from the server's. */}
              <p className="truncate text-xs text-slate-500" suppressHydrationWarning>
                {[
                  m.name && m.email,
                  !m.signedIn ? (m.inviteSentAt ? `invited · email sent ${relativeTime(new Date(m.inviteSentAt))}` : "invited, hasn't signed in yet") : !m.hasPassword && "no password yet (send a password link)",
                  // When their invite link runs out (ver_114), so you know when to copy a new one.
                  !m.signedIn && !m.hasPassword && m.inviteUntil && (new Date(m.inviteUntil) > new Date() ? `link works until ${linkUntil(new Date(m.inviteUntil), zone)}` : "link ran out, copy a new one"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {canManage ? (
              <>
                <Select
                  aria-label={`Role for ${m.email}`}
                  className="h-8 w-auto max-w-full text-xs"
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => act(() => changeRole(projectId, m.userId, e.target.value))}
                >
                  {ROLES_PICK.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                {!m.signedIn && canEmail && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    title="Email them a fresh invite"
                    onClick={() =>
                      start(async () => {
                        const res = await sendInvite(projectId, m.userId);
                        setError(res.ok ? null : res.error);
                        setSent(res.ok ? `Invite sent to ${res.email}` : null);
                        router.refresh();
                      })
                    }
                  >
                    Resend
                  </Button>
                )}
                {!m.signedIn && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    title="A one-time invite link to paste into Teams, Slack or an email. It works for 7 days."
                    onClick={() =>
                      start(async () => {
                        const res = await copyInviteLink(projectId, m.userId);
                        if (!res.ok) return setError(res.error);
                        setError(null);
                        setInviteLink({ userId: m.userId, message: res.message });
                        navigator.clipboard?.writeText(res.message).catch(() => {});
                        // The row's "link works until" moves to the new link's date.
                        router.refresh();
                      })
                    }
                  >
                    Copy invite link
                  </Button>
                )}
                {m.userId !== me && m.signedIn && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    title="Make a one-time link they can use to set a new password"
                    onClick={() =>
                      start(async () => {
                        const res = await createPasswordLink(projectId, m.userId);
                        if (!res.ok) return setError(res.error);
                        setError(null);
                        setLink({ userId: m.userId, url: res.url, hours: res.hours });
                      })
                    }
                  >
                    Password link
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => confirm(`Remove ${m.email} from this test cycle?`) && act(() => removeMember(projectId, m.userId))}
                >
                  Remove
                </Button>
              </>
            ) : (
              <RoleBadge role={m.role} />
            )}
            {link?.userId === m.userId && (
              <div className="w-full rounded-md bg-accent-50 p-3 text-xs text-slate-700">
                <p className="mb-1.5">
                  Send this link to {m.name ?? m.email} (in Teams, Slack or email). It works once and expires in {link.hours} hours. Their current password stops
                  working once they use it.
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={link.url} aria-label="Password link" className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <Button size="sm" onClick={() => navigator.clipboard?.writeText(link.url)}>
                    Copy
                  </Button>
                  {canEmail && (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await emailPasswordLink(projectId, m.userId);
                          setError(res.ok ? null : res.error);
                          if (res.ok) {
                            setLink(null);
                            setSent(`Password link emailed to ${res.email}`);
                          }
                        })
                      }
                    >
                      Email it to them
                    </Button>
                  )}
                </div>
              </div>
            )}
            {inviteLink?.userId === m.userId && (
              <div className="w-full rounded-md bg-accent-50 p-3 text-xs text-slate-700">
                <p className="mb-1.5">Copied. Paste it to {m.name ?? m.email} in Teams, Slack or an email:</p>
                <Input readOnly value={inviteLink.message} aria-label="Invite link" className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {/* nudge is built on the server page, so it needs a key to sit among these children (React warned otherwise) */}
      {canManage && nudge && <Fragment key="nudge">{nudge}</Fragment>}
      {canManage && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await addMember(projectId, { email, role, sendInvite: canEmail && sendIt });
              setError(res.ok ? null : res.error);
              setSent(null);
              setInvited(null);
              if (res.ok) {
                setEmail("");
                if (res.emailed) setSent(`Invite sent to ${res.email}. Not there? Use Copy invite link on their row.`);
                else setInvited({ email: res.email, role: res.role, hasPassword: res.hasPassword, failed: !!res.emailError, message: res.message });
              }
              router.refresh();
            });
          }}
        >
          <div className="min-w-56 flex-1">
            <Field label="Add someone by email" htmlFor="invite">
              <Input id="invite" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
            </Field>
          </div>
          <Select aria-label="Role" className="w-auto max-w-full" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES_PICK.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" disabled={pending}>
            Add
          </Button>
          {/* The hint sits under the whole row so the role and Add line up with the email box (ver_94). */}
          {/* ver_114: the old "choose a password the first time" hint wasn't true; new people need their invite link. */}
          {canEmail ? (
            <div className="w-full">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={sendIt} onChange={(e) => setSendIt(e.target.checked)} className="accent-accent-600" />
                Email them an invite link
              </label>
              <p className="mt-0.5 text-xs text-slate-500">The email has a link that lets them in once and works for 7 days. Untick it to copy the message yourself.</p>
            </div>
          ) : (
            <p className="-mt-1 w-full text-xs text-slate-500">You&apos;ll get a link to send them. It lets them in once and works for 7 days.</p>
          )}
        </form>
      )}
      {sent && (
        <p role="status" className="mt-3 inline-block rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white">
          {sent}
        </p>
      )}
      {invited && <InviteNote {...invited} name={members.find((m) => m.email === invited.email)?.name ?? null} onClose={() => setInvited(null)} />}
    </Card>
  );
}

/** Without email set up (or when sending failed), after Add the admin gets a message to paste into Teams, Slack or email. */
export function InviteNote({ email, role, hasPassword, name, failed = false, message: invite = null, onClose }: { email: string; role: Role; hasPassword: boolean; name: string | null; failed?: boolean; message?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const signIn = typeof window === "undefined" ? "/signin" : `${window.location.origin}/signin`;
  // Someone new gets their one-time invite link (ver_114); someone who already uses Flaw Patrol signs in as usual.
  const message =
    invite ?? `You've been added to a team in Flaw Patrol. Sign in at ${signIn} with ${email}${hasPassword ? " and your usual password" : ""}.`;
  const who = name ?? email;
  return (
    <div role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      <div className="flex items-start justify-between gap-2">
        <p>
          <b>
            {who} was added as {ROLE_LABEL[role]}.
          </b>{" "}
          {failed ? "Couldn't send the invite email, so send them this instead:" : invite ? "Send them this so they can get in:" : "Send them this:"}
        </p>
        <button type="button" onClick={onClose} aria-label="Hide invite message" className="rounded px-1.5 text-emerald-700 hover:bg-emerald-100">
          ×
        </button>
      </div>
      <p data-testid="invite-message" className="my-2 rounded-md border border-emerald-200 bg-surface p-2.5 text-slate-700">
        {message}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(message).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          Copy message
        </Button>
        {copied ? <span className="text-xs text-emerald-700">Copied</span> : <span className="text-xs text-emerald-800/80">Paste it into Slack, Teams or an email.</span>}
      </div>
    </div>
  );
}

export function ProjectDetailsForm({ projectId, name, description }: { projectId: string; name: string; description: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Test cycle details</h2>
      <form
        className="space-y-3"
        action={(fd) =>
          start(async () => {
            const res = await updateProject(projectId, { name: String(fd.get("name")), description: String(fd.get("description")) });
            setError(res.ok ? null : res.error);
            setSaved(res.ok);
            router.refresh();
          })
        }
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={name} required onChange={() => setSaved(false)} />
        </Field>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" name="description" rows={2} defaultValue={description} onChange={() => setSaved(false)} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
      </form>
    </Card>
  );
}
