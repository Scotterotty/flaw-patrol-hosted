"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PersonView } from "@/lib/digest-data";
import { count } from "@/lib/format";
import { checkAdminRemoval, makeWorkspaceAdmin, removeWorkspaceAdmin, searchPeopleForAdmin, type RemovalCheck } from "@/server/workspace-admins";
import { Modal } from "./modal";
import { Button, Card, ErrorText } from "./ui";

/** What a new workspace admin can do, shown before you confirm. */
export const ADMIN_POWERS = ["Open and change every project, even ones they're not on", "Change sign-in, email, and bug templates", "Update Flaw Patrol with the Update button", "Make or remove other admins"];

const orList = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);

/** Workspace settings → Admins: who the workspace admins are, add one, or take it away. */
export function WorkspaceAdmins({ admins, meId }: { admins: PersonView[]; meId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; people: PersonView[] } | null>(null);
  const [picked, setPicked] = useState<PersonView | null>(null);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [removing, setRemoving] = useState<{ person: PersonView; check: RemovalCheck } | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onlyOne = admins.length <= 1;
  const term = q.trim();

  // Search everyone in the database, a moment after typing stops.
  useEffect(() => {
    if (picked || term.length < 2) return;
    let stale = false;
    const t = setTimeout(async () => {
      const r = await searchPeopleForAdmin(term);
      if (!stale) setFound(r.ok ? { q: term, people: r.people } : { q: term, people: [] });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [term, picked]);

  const matches = !picked && found?.q === term ? found.people : [];
  const exact = matches.find((p) => p.email.toLowerCase() === term.toLowerCase());
  const target = picked ?? exact ?? (matches.length === 1 ? matches[0] : null);
  const first = (p: { name: string }) => p.name.split(/\s+/)[0] || p.name;
  const choose = (p: PersonView) => (setPicked(p), setQ(p.name), setError(null));
  const askAdd = () => {
    if (!target) return;
    choose(target);
    setConfirmAdd(true);
  };

  const add = () =>
    start(async () => {
      if (!target) return;
      const r = await makeWorkspaceAdmin(target.id);
      if (!r.ok) return setError(r.error);
      setConfirmAdd(false);
      setPicked(null);
      setQ("");
      setFound(null);
      router.refresh();
    });

  const askRemove = (p: PersonView) =>
    start(async () => {
      setError(null);
      setUnderstood(false);
      const r = await checkAdminRemoval(p.id);
      if (!r.ok) return setError(r.error);
      setRemoving({ person: p, check: r.check });
    });

  const remove = () =>
    start(async () => {
      if (!removing) return;
      const r = await removeWorkspaceAdmin(removing.person.id, { understoodSignIn: understood });
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
      <p className="mt-0.5 text-sm text-slate-600">Admins can open every project and change these workspace settings. There&apos;s always at least one.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100" aria-label="Workspace admins">
        {admins.map((a) => {
          const open = removing?.person.id === a.id ? removing.check : null;
          return (
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
                {!open && (
                  <Button size="sm" disabled={pending || onlyOne} onClick={() => askRemove(a)} aria-label={`Remove ${a.name} as a workspace admin`}>
                    Remove
                  </Button>
                )}
              </div>
              {open && (
                <div className="mt-2 rounded-md bg-red-50 px-3 py-3 text-sm text-red-950 ring-1 ring-red-200" role="group" aria-label="Confirm remove">
                  <p className="font-semibold">{open.self ? "Stop being a workspace admin?" : `Remove ${open.name} as a workspace admin?`}</p>
                  <p className="mt-2 font-medium">{open.self ? "You'll lose:" : `${first(open)} will lose:`}</p>
                  <ul className="mt-0.5 list-disc pl-5">
                    <li>Workspace settings{open.self ? ". This page closes right away." : "."}</li>
                    <li>
                      {open.projectsLost
                        ? `${count(open.projectsLost, "project")} ${open.self ? "you're" : "they're"} not a member of. ${open.self ? "You" : "They"} can only open ${open.projectsLost === 1 ? "it" : "them"} as an admin.`
                        : `No projects: ${open.self ? "you're" : "they're"} a member of every one.`}
                    </li>
                  </ul>
                  <p className="mt-2">{open.self ? "You keep" : `${first(open)} keeps`} the projects {open.self ? "you're" : "they're"} a member of, with the same roles. This can be undone: any admin can make {open.self ? "you" : "them"} an admin again.</p>
                  {open.signInRisk && (
                    <div className="mt-3 rounded-md bg-white/70 px-3 py-2 ring-1 ring-red-300" role="alert">
                      <p className="font-semibold">Check how {open.self ? "you sign" : `${first(open)} signs`} in first</p>
                      {open.signInWith.length ? (
                        <>
                          <p className="mt-1">
                            Password sign-in is only on for admins. If {open.self ? "you" : first(open)} only {open.self ? "use" : "uses"} a password, {open.self ? "you" : "they"} won&apos;t be able to sign in after this. They&apos;d need {orList(open.signInWith)} instead.
                          </p>
                          <label className="mt-2 flex items-start gap-2">
                            <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                            <span>
                              {open.self ? "I can" : `${first(open)} can`} sign in with {orList(open.signInWith)}
                            </span>
                          </label>
                        </>
                      ) : (
                        <p className="mt-1">Password sign-in is only on for admins and no company sign-in is turned on, so {open.self ? "you" : first(open)} couldn&apos;t sign in at all. Turn one on under Sign-in first.</p>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" onClick={() => setRemoving(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="danger" disabled={pending || (open.signInRisk && (!understood || !open.signInWith.length))} onClick={remove}>
                      {open.self ? "Stop being an admin" : "Remove admin"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {onlyOne && <p className="mt-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">You&apos;re the only admin, so you can&apos;t be removed. Add another admin first.</p>}

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
                askAdd();
              }
            }}
          />
          <Button variant="primary" size="sm" disabled={pending || !target} onClick={askAdd}>
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
        {!picked && found?.q === term && term.length >= 2 && !matches.length && (
          <p className="mt-1 text-xs text-slate-500">Nobody else with an account matches. Invite them to a project first, then make them an admin.</p>
        )}
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
            <p className="mt-3 text-sm text-slate-600">The Activity log records who made them an admin. You can take it away later from this list.</p>
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
