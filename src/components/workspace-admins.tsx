"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PersonView } from "@/lib/digest-data";
import { makeWorkspaceAdmin, removeWorkspaceAdmin } from "@/server/workspace-admins";
import { Modal } from "./modal";
import { Button, Card, ErrorText } from "./ui";

/** What a new workspace admin can do, shown before you confirm. */
export const ADMIN_POWERS = ["Open and change every project", "Change sign-in, email, and bug templates", "Update Flaw Patrol with the Update button", "Make or remove other admins"];

/** Workspace settings → Admins: who the workspace admins are, add one, or take it away. */
export function WorkspaceAdmins({ admins, people, meId }: { admins: PersonView[]; people: PersonView[]; meId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<PersonView | null>(null);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [removing, setRemoving] = useState<PersonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onlyOne = admins.length <= 1;
  const term = q.trim().toLowerCase();
  const others = people.filter((p) => !admins.some((a) => a.id === p.id));
  const matches = term && !picked ? others.filter((p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term)).slice(0, 6) : [];
  const exact = others.find((p) => p.email.toLowerCase() === term);
  const choose = (p: PersonView) => (setPicked(p), setQ(p.name), setError(null));
  const target = picked ?? exact ?? (matches.length === 1 ? matches[0] : null);
  const first = (p: PersonView) => p.name.split(/\s+/)[0] || p.name;

  const add = () =>
    start(async () => {
      if (!target) return;
      const r = await makeWorkspaceAdmin(target.id);
      if (!r.ok) return setError(r.error);
      setConfirmAdd(false);
      setPicked(null);
      setQ("");
      router.refresh();
    });
  const remove = (p: PersonView) =>
    start(async () => {
      const r = await removeWorkspaceAdmin(p.id);
      if (!r.ok) return setError(r.error);
      setRemoving(null);
      // Without admin, Workspace settings isn't yours anymore.
      if (r.self) router.push("/");
      else router.refresh();
    });

  return (
    <Card id="admins" data-howto="workspace-admins" className="scroll-mt-28 p-5" role="region" aria-labelledby="admins-heading">
      <h2 id="admins-heading" className="text-sm font-semibold text-slate-800">
        Workspace admins
      </h2>
      <p className="mt-0.5 text-sm text-slate-600">Admins can open every project and change these workspace settings.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100" aria-label="Workspace admins">
        {admins.map((a) => (
          <li key={a.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-50 text-sm font-bold text-accent-900">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-slate-800">{a.name}</span>
                {a.id === meId && <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-900">You</span>}
                <span className="block truncate text-xs text-slate-500">{a.email}</span>
              </span>
              <Button size="sm" disabled={pending || onlyOne} onClick={() => (setRemoving(a), setError(null))} aria-label={`Remove ${a.name} as a workspace admin`}>
                Remove
              </Button>
            </div>
            {removing?.id === a.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900" role="group" aria-label="Confirm remove">
                <span className="min-w-0 flex-1">
                  {a.id === meId ? "Stop being a workspace admin? You keep your projects, but you won't see Workspace settings anymore." : `Remove ${a.name} as a workspace admin? ${first(a)} keeps their projects.`}
                </span>
                <Button size="sm" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => remove(a)}>
                  Remove admin
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {onlyOne && <p className="mt-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">You&apos;re the only admin. Add another admin before you can remove yourself.</p>}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="Person to make a workspace admin"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm"
            placeholder="Type a name or email…"
            value={q}
            onChange={(e) => (setQ(e.target.value), setPicked(null), setConfirmAdd(false))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && target) {
                e.preventDefault();
                setPicked(target);
                setQ(target.name);
                setConfirmAdd(true);
              }
            }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={pending || !target}
            onClick={() => {
              if (!target) return;
              setPicked(target);
              setQ(target.name);
              setConfirmAdd(true);
            }}
          >
            Make admin
          </Button>
        </div>
        {matches.length > 0 && !(matches.length === 1 && exact) && (
          <ul className="mt-1 rounded-md border border-slate-200 bg-surface text-sm shadow-sm" aria-label="Matching people">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full gap-2 px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => choose(p)}>
                  {p.name} <span className="text-xs text-slate-500">{p.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {term && !picked && !matches.length && <p className="mt-1 text-xs text-slate-500">Nobody with an account matches. Invite them to a project first, then make them an admin.</p>}
      </div>

      <Modal open={confirmAdd && !!target} onClose={() => setConfirmAdd(false)} title={target ? `Make ${target.name} a workspace admin?` : "Make admin"}>
        {target && (
          <div role="group" aria-label="Confirm new admin">
            <p className="text-sm text-slate-700">{first(target)} will be able to:</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {ADMIN_POWERS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" onClick={() => setConfirmAdd(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={pending} onClick={add}>
                Make admin
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
