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
import { Button, Card, ErrorText, Field, Input, Label, Select, Textarea } from "./ui";

type Member = { userId: string; email: string; name: string | null; role: Role; signedIn: boolean; hasPassword: boolean; avatarAt: Date | null; inviteSentAt?: Date | null; inviteUntil?: Date | null; title: string | null; frame: string | null };


export function MembersPanel({ projectId, members, canManage, me, canEmail = false, passwords = true, nudge, requests = [], team = "" }: { projectId: string; members: Member[]; canManage: boolean; me: string; canEmail?: boolean; /** False on a company-sign-in-only server: no invite or password links. */ passwords?: boolean; nudge?: ReactNode; requests?: JoinRequestRow[]; team?: string }) {
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
  const [bulk, setBulk] = useState<{ role: Role; rows: BulkRow[] } | null>(null);
  const emailCount = emailList(email).length;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Failed"));
      if (res.ok) after?.();
      router.refresh();
    });

  return (
    <Card id="members" className="scroll-mt-20 p-5" data-howto="settings-members">
      <h2 className="text-sm font-semibold text-slate-800">Members</h2>
      {/* The Roles row is the one place that says what each role can do, so it stays right when presets change. */}
      {canManage && (
        <p className="mt-1 mb-4 text-xs">
          <a href="#roles" className="font-medium text-accent-700 hover:underline">
            What each role can do →
          </a>
        </p>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {/* Ask to join: people who opened a link here and asked, on top for admins. */}
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
                  // When their invite link runs out, so you know when to copy a new one.
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
                  data-howto="member-role"
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
                {!m.signedIn && passwords && (
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
                {m.userId !== me && m.signedIn && passwords && (
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
                        // Only workspace admins see the link; anyone else's goes to the person's email.
                        if ("emailed" in res) return setSent(`Password link emailed to ${res.emailed}`);
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
          className="mt-4 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const list = emailList(email);
            if (!list.length) return setError("Enter an email");
            start(async () => {
              setSent(null);
              setInvited(null);
              setBulk(null);
              // One person: the message for them, as before.
              if (list.length === 1) {
                const res = await addMember(projectId, { email: list[0], role, sendInvite: canEmail && sendIt });
                setError(res.ok ? null : res.error);
                if (res.ok) {
                  setEmail("");
                  if (res.emailed) setSent(passwords ? `Invite sent to ${res.email}. Not there? Use Copy invite link on their row.` : `Invite sent to ${res.email}.`);
                  else setInvited({ email: res.email, role: res.role, hasPassword: res.hasPassword, failed: !!res.emailError, message: res.message });
                }
                router.refresh();
                return;
              }
              // The whole team at once (Monday audit): each gets their own link, all copied in one go.
              const done: BulkRow[] = [];
              for (const one of list) {
                const res = await addMember(projectId, { email: one, role, sendInvite: canEmail && sendIt });
                done.push(res.ok ? { email: res.email, ok: true, emailed: res.emailed, url: res.inviteUrl, message: res.message } : { email: one, ok: false, error: res.error });
              }
              const failed = done.filter((r) => !r.ok);
              setError(failed.length ? `Couldn't add ${failed.map((r) => r.email).join(", ")}: ${failed[0].error}` : null);
              // Keep only the emails that didn't go in, so they can be fixed and added again.
              setEmail(failed.map((r) => r.email).join("\n"));
              if (done.some((r) => r.ok)) setBulk({ role, rows: done.filter((r) => r.ok) });
              router.refresh();
            });
          }}
        >
          {/* One row: email box, role and Add share one height and line up at the top.
              All help text sits under the whole row so nothing pushes role and Add down.
              On a phone the box takes the full width and role + Add sit together under it. */}
          <Label htmlFor="invite">Add people by email</Label>
          <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
            <Textarea
              id="invite"
              data-howto="invite-email"
              required
              rows={emailCount > 1 ? Math.min(emailCount, 6) : 1}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds a line for the next email; Ctrl + Enter adds everyone.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="teammate@company.com"
              className="min-h-9 min-w-0 py-[7px] leading-5 flex-1 basis-full resize-y sm:basis-0"
            />
            <Select aria-label="Role" data-howto="invite-role" className="w-auto max-w-full flex-1 sm:flex-none" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES_PICK.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="primary" disabled={pending} data-howto="invite-add" className="h-9 shrink-0">
              {emailCount > 1 ? `Add ${emailCount} people` : "Add"}
            </Button>
          </div>
          {/* The old "choose a password the first time" hint wasn't true; new people need their invite link. */}
          {canEmail ? (
            <div className="mt-1.5">
              <p className="text-xs text-slate-500">One per line, or commas between them.</p>
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={sendIt} onChange={(e) => setSendIt(e.target.checked)} className="accent-accent-600" />
                Email them an invite link
              </label>
              <p className="mt-0.5 text-xs text-slate-500">The email has a link that lets them in once and works for 7 days. Untick it to copy the message yourself.</p>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">One per line, or commas between them. You&apos;ll get a link to send each person. It lets them in once and works for 7 days.</p>
          )}
        </form>
      )}
      {sent && (
        <p role="status" className="mt-3 inline-block rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white">
          {sent}
        </p>
      )}
      {invited && <InviteNote {...invited} name={members.find((m) => m.email === invited.email)?.name ?? null} onClose={() => setInvited(null)} />}
      {bulk && <BulkInviteNote {...bulk} onClose={() => setBulk(null)} />}
    </Card>
  );
}

/** Emails typed one per line, or with commas, spaces or semicolons between them. Each once. */
export function emailList(text: string) {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.toLowerCase()))];
}

type BulkRow = { email: string; ok: boolean; emailed?: boolean; url?: string | null; message?: string | null; error?: string };

/** One post for Slack or Teams with each new person's own link (Monday audit: 10 teammates were 10 pastes). */
export function allInvites(rows: BulkRow[], signIn: string) {
  const lines = rows.map((r) => (r.url ? `• ${r.email}: ${r.url}` : r.emailed ? `• ${r.email}: check your email for the invite` : `• ${r.email}: sign in as usual at ${signIn}`));
  const links = rows.some((r) => r.url);
  return `You're invited to Flaw Patrol.${links ? " Find your email and open your own link to choose your password and sign in. Each link works once, for 7 days." : ""}\n${lines.join("\n")}`;
}

/** After adding several people: who was added, each person's link, and Copy all invites. */
function BulkInviteNote({ role, rows, onClose }: { role: Role; rows: BulkRow[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const signIn = typeof window === "undefined" ? "/signin" : `${window.location.origin}/signin`;
  const copy = (key: string, text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  return (
    <div role="status" data-testid="bulk-invites" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      <div className="flex items-start justify-between gap-2">
        <p>
          <b>
            {rows.length} people added as {ROLE_LABEL[role]}.
          </b>
        </p>
        <button type="button" onClick={onClose} aria-label="Hide invites" className="rounded px-1.5 text-emerald-700 hover:bg-emerald-100">
          ×
        </button>
      </div>
      <ul className="my-2 divide-y divide-emerald-100 rounded-md border border-emerald-200 bg-surface text-slate-700">
        {rows.map((r) => (
          <li key={r.email} className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="min-w-0 truncate">{r.email}</span>
            {r.message ? (
              <button type="button" className="text-xs text-accent-700 hover:underline" onClick={() => copy(r.email, r.message!)}>
                {copied === r.email ? "Copied" : "Copy link"}
              </button>
            ) : (
              <span className="text-xs text-slate-500">{r.emailed ? "Invite emailed" : "Signs in as usual"}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => copy("all", allInvites(rows, signIn))}>
          Copy all invites
        </Button>
        {copied === "all" ? <span className="text-xs text-emerald-700">Copied</span> : <span className="text-xs text-emerald-800/80">One Slack or Teams post with each person&apos;s own link.</span>}
      </div>
    </div>
  );
}

/** Without email set up (or when sending failed), after Add the admin gets a message to paste into Teams, Slack or email. */
export function InviteNote({ email, role, hasPassword, name, failed = false, message: invite = null, onClose }: { email: string; role: Role; hasPassword: boolean; name: string | null; failed?: boolean; message?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const signIn = typeof window === "undefined" ? "/signin" : `${window.location.origin}/signin`;
  // Someone new gets their one-time invite link; someone who already uses Flaw Patrol signs in as usual.
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
