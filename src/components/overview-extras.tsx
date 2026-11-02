"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition, type ReactNode } from "react";
import type { Role } from "@prisma/client";
import { ROLE_LABEL, ROLES_PICK } from "@/lib/permissions";
import { setQuestMap } from "@/server/account";
import { addMember } from "@/server/projects";
import { Button, Card, ErrorText, Input, Select } from "./ui";

/** On a project's Overview while only one person is on it: add teammates without hunting for Settings → Members. */
export function InviteTeam({
  projectId,
  projectName,
  umbrella,
  canEmail = false,
  alone = true,
  nudge,
}: {
  /** The before-invite reminder, for admins until they choose what roles can do. */
  nudge?: ReactNode;
  /** Only one person is on it. After an invite the card stays (showing who joined) until Done. */
  alone?: boolean;
  projectId: string;
  projectName: string;
  /** Workspace settings → Email is set up: invites go out by email. */
  canEmail?: boolean;
  /** In an umbrella: people join the umbrella, so they get every test cycle in it. */
  umbrella?: { id: string; name: string; hubId: string } | null;
}) {
  const router = useRouter();
  const storageKey = `fp-invite-hidden:${projectId}`;
  const [hidden, setHidden] = useState(true);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("TESTER");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(storageKey) === "1");
    } catch {
      setHidden(false);
    }
    setOrigin(window.location.origin);
  }, [storageKey]);
  if (hidden || (!alone && added.length === 0)) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {}
  };
  return (
    <Card className="mb-5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Invite your team</h2>
          {umbrella ? (
            <p className="text-sm text-slate-500">
              Invite people to {umbrella.name}. Everyone there gets every test cycle. They set a password on first sign-in. Change roles in{" "}
              <a className="text-accent-700 hover:underline" href={`/g/${umbrella.id}/settings#members`}>
                {umbrella.name} members
              </a>
              .
            </p>
          ) : (
            <p className="text-sm text-slate-500">Only you are on {projectName}. Add testers by email; they set a password on first sign-in.</p>
          )}
        </div>
        <button type="button" onClick={dismiss} aria-label="Hide Invite your team" className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          ×
        </button>
      </div>
      {/* nudge is built on the server page, so it needs a key to sit among these children (React warned otherwise) */}
      {nudge && <Fragment key="nudge">{nudge}</Fragment>}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const list = emails.split(/[\s,;]+/).filter(Boolean);
          start(async () => {
            const failed: string[] = [];
            for (const email of list) {
              const r = await addMember(umbrella?.hubId ?? projectId, { email, role, sendInvite: canEmail });
              if (!r.ok) return setError(`${email}: ${r.error}`);
              if (canEmail && !r.emailed) failed.push(email);
            }
            setEmails("");
            setAdded((a) => [...a, ...list.filter((e) => !a.includes(e))]);
            // Without email set up, the admin passes the sign-in link on.
            setNote(!canEmail ? "No email goes out, so send them the sign-in link below." : failed.length ? `Couldn't email ${failed.join(", ")}, so send them the sign-in link below.` : "Invites emailed.");
            router.refresh();
          });
        }}
      >
        <Input aria-label="Emails to invite" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com, another@company.com" className="min-w-64 flex-1" />
        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-auto max-w-full">
          {ROLES_PICK.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={pending || !emails.trim()}>
          {pending ? "Inviting…" : umbrella ? `Invite to ${umbrella.name}` : "Invite"}
        </Button>
      </form>
      {added.length > 0 && (
        <div role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>
            <span className="font-semibold">Added:</span> {added.join(", ")}. {note}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-emerald-800">Sign-in link:</span>
            <code className="rounded bg-white px-2 py-0.5 text-slate-800">{origin}/signin</code>
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(`${origin}/signin`).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="primary" className="ml-auto" onClick={dismiss}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** One click to turn on quest maps (and with them the mini game). */
export function QuestMapOnButton({ label = "Turn on quest maps", size }: { label?: string; size?: "sm" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      variant="primary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setQuestMap(true);
          router.refresh();
        })
      }
    >
      {pending ? "Turning on…" : label}
    </Button>
  );
}
