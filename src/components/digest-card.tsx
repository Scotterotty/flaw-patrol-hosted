"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { DigestCardData, GroupView, PersonView } from "@/lib/digest-data";
import { cleanEmail, DIGEST_KINDS, joinAnd, type DigestSettings } from "@/lib/digest-settings";
import { deleteEmailGroup, saveDigest, saveEmailGroup, sendDigestSample, setCycleDigest, turnOffDigest, type DigestTarget } from "@/server/digests";
import { Button, Card, cx, ErrorText, InfoTip, Input } from "./ui";

// Email digests: umbrella Settings → Email digests, a test cycle's choice, and
// Workspace settings → Email → Email groups. One group editor serves all three.

const groupLine = (g: GroupView) => {
  const names = [...g.people.map((p) => p.name), ...g.addresses];
  return names.length > 4 ? `${names.length} people` : names.join(", ");
};

/** The Email digests card: who gets them, extra groups and addresses, and what is sent. */
export function DigestCard({ target, data, canManage, team, isAdmin, id = "email-digests" }: { target: DigestTarget; data: DigestCardData; canManage: boolean; team: string; isAdmin: boolean; id?: string }) {
  const router = useRouter();
  const [s, setS] = useState<DigestSettings>(data.settings);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true; note?: string } | { ok: false; error: string }>, ok: string) =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setNote(r.note ?? ok);
      router.refresh();
    });
  const tick = (key: keyof DigestSettings, label: string, tip?: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!s[key]} disabled={!canManage} onChange={(e) => setS((x) => ({ ...x, [key]: e.target.checked }))} />
      {label}
      {tip && <InfoTip text={tip} />}
    </label>
  );
  return (
    <Card id={id} className="scroll-mt-20 space-y-4 p-5" role="region" aria-label="Email digests">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          Email digests
          <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", data.settings.on ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>{data.settings.on ? "On" : "Off"}</span>
        </h2>
      </div>
      {!data.mailOn && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Email isn&apos;t set up for this workspace yet. A workspace admin sets it up in{" "}
          <Link href="/workspace#email" className="font-medium underline">
            Workspace settings → Email
          </Link>
          .
        </p>
      )}
      {!canManage && <p className="text-sm text-slate-600">{data.summary}</p>}
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Who gets them</legend>
        {tick("testers", "People who tested in the run or joined the bug bash")}
        {tick("starter", "Whoever started it")}
        {tick("everyone", `Everyone in ${team} (${data.teamSize} ${data.teamSize === 1 ? "person" : "people"})`)}
      </fieldset>
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Also send to <InfoTip text="Email groups, or single addresses for people outside Flaw Patrol. Someone in two groups, or in a group and also a tester, gets one email." />
        </p>
        <AlsoSendTo groups={data.groups} people={data.people} groupIds={s.groupIds} addresses={s.addresses} canEdit={canManage} isAdmin={isAdmin} onChange={(groupIds, addresses) => setS((x) => ({ ...x, groupIds, addresses }))} />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">What to send</legend>
        {DIGEST_KINDS.map((k) => (
          <div key={k.id}>{tick(k.id, k.label)}</div>
        ))}
      </fieldset>
      <p className="text-xs text-slate-500">Each person&apos;s own choice in Your account → Emails I get wins. Someone who picks None gets nothing.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => saveDigest(target, s), "Saved. Email digests are on.")}>
            Save
          </Button>
          <Button size="sm" disabled={pending || !data.mailOn} title={data.mailOn ? "Sends the newest run here, laid out as a digest, to you only." : "Email isn't set up yet."} onClick={() => run(() => sendDigestSample(target), "Sent.")} data-howto="digest-sample">
            Send me a sample
          </Button>
          {data.settings.on && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => turnOffDigest(target), "Email digests are off.")}>
              Turn off email digests
            </Button>
          )}
          <span role="status" className="text-xs text-emerald-700">
            {note}
          </span>
        </div>
      )}
    </Card>
  );
}

/** Groups and single addresses, with a search box: matching groups first, then people, then the typed address. */
function AlsoSendTo({
  groups,
  people,
  groupIds,
  addresses,
  canEdit,
  isAdmin,
  onChange,
}: {
  groups: GroupView[];
  people: PersonView[];
  groupIds: string[];
  addresses: string[];
  canEdit: boolean;
  isAdmin: boolean;
  onChange: (groupIds: string[], addresses: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GroupView | "new" | null>(null);
  const [made, setMade] = useState<GroupView[]>([]);
  const all = useMemo(() => [...groups, ...made.filter((m) => !groups.some((g) => g.id === m.id))], [groups, made]);
  const term = q.trim().toLowerCase();
  const matchGroups = all.filter((g) => !term || g.name.toLowerCase().includes(term));
  const matchPeople = term ? people.filter((p) => !addresses.includes(p.email.toLowerCase()) && (p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term))).slice(0, 6) : [];
  const typed = cleanEmail(q);
  const addAddress = (e: string) => {
    if (!addresses.includes(e)) onChange(groupIds, [...addresses, e]);
    setQ("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 p-1.5">
        {groupIds.map((id) => {
          const g = all.find((x) => x.id === id);
          if (!g) return null;
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-900">
              <button type="button" className="hover:underline" title={`Change who's in ${g.name}`} onClick={() => setEditing(g)}>
                👥 {g.name} ({g.people.length + g.addresses.length})
              </button>
              {canEdit && (
                <button type="button" aria-label={`Remove ${g.name}`} className="text-accent-700 hover:text-accent-900" onClick={() => onChange(groupIds.filter((x) => x !== id), addresses)}>
                  ✕
                </button>
              )}
            </span>
          );
        })}
        {addresses.map((a) => (
          <span key={a} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {a}
            {canEdit && (
              <button type="button" aria-label={`Remove ${a}`} className="text-slate-500 hover:text-slate-800" onClick={() => onChange(groupIds, addresses.filter((x) => x !== a))}>
                ✕
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <input
            aria-label="Add a group or an email address"
            className="min-w-48 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
            placeholder="Add a group or an email address…"
            value={q}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed) {
                e.preventDefault();
                addAddress(typed);
              }
            }}
          />
        )}
        {!canEdit && !groupIds.length && !addresses.length && <span className="px-1 text-sm text-slate-500">Nobody else.</span>}
      </div>
      {canEdit && open && (
        <ul role="listbox" aria-label="Groups and people" className="max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-sm">
          {matchGroups.map((g) => {
            const added = groupIds.includes(g.id);
            return (
              <li key={g.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="flex-1">
                  👥 {g.name} <span className="text-xs text-slate-500">{g.people.length + g.addresses.length === 1 ? "1 person" : `${g.people.length + g.addresses.length} people`}</span>
                </span>
                {added ? (
                  <span className="text-xs text-slate-500">added</span>
                ) : (
                  <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange([...groupIds, g.id], addresses), setQ(""))} aria-label={`Add ${g.name}`}>
                    Add
                  </button>
                )}
              </li>
            );
          })}
          {matchPeople.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1">
                {p.name} <span className="text-xs text-slate-500">{p.email}</span>
              </span>
              <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => addAddress(p.email.toLowerCase())}>
                Add
              </button>
            </li>
          ))}
          {typed && !addresses.includes(typed) && !matchPeople.some((p) => p.email.toLowerCase() === typed) && (
            <li className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1">{typed}</span>
              <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => addAddress(typed)}>
                Add address
              </button>
            </li>
          )}
          <li className="border-t border-slate-100 px-3 py-1.5">
            <button type="button" className="text-sm font-medium text-accent-700 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => (setEditing("new"), setOpen(false))}>
              ＋ New email group…
            </button>
          </li>
        </ul>
      )}
      {editing && (
        <div className="rounded-md border border-slate-200 p-3">
          <GroupEditor
            group={editing === "new" ? null : editing}
            people={people}
            isAdmin={isAdmin}
            canEdit={canEdit || editing !== "new"}
            onDone={(saved) => {
              if (saved && editing === "new") {
                setMade((m) => [...m, saved]);
                onChange([...groupIds, saved.id], addresses);
              }
              setEditing(null);
            }}
            onDeleted={(id) => {
              onChange(
                groupIds.filter((x) => x !== id),
                addresses,
              );
              setEditing(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Make or change a group: a name, and Flaw Patrol people or any address. Admins can delete it. */
export function GroupEditor({ group, people, isAdmin, canEdit = true, onDone, onDeleted }: { group: GroupView | null; people: PersonView[]; isAdmin: boolean; canEdit?: boolean; onDone: (saved: GroupView | null) => void; onDeleted?: (id: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<PersonView[]>(group?.people ?? []);
  const [addresses, setAddresses] = useState<string[]>(group?.addresses ?? []);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const term = q.trim().toLowerCase();
  const matches = term ? people.filter((p) => !members.some((m) => m.id === p.id) && (p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term))).slice(0, 6) : [];
  const typed = cleanEmail(q);
  const add = (p: PersonView) => (setMembers((m) => [...m, p]), setQ(""));
  const addTyped = () => {
    if (!typed) return;
    const p = people.find((x) => x.email.toLowerCase() === typed);
    if (p) add(p);
    else if (!addresses.includes(typed)) setAddresses((a) => [...a, typed]);
    setQ("");
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveEmailGroup({ id: group?.id ?? null, name, userIds: members.map((m) => m.id), addresses });
      if (!r.ok) return setError(r.error);
      router.refresh();
      onDone({ id: r.id, name: r.name, people: members, addresses, usedBy: group?.usedBy ?? [], createdBy: group?.createdBy ?? "" });
    });
  return (
    <div className="space-y-3" role="group" aria-label={group ? `Edit ${group.name}` : "New email group"}>
      <h3 className="text-sm font-semibold text-slate-800">{group ? `Edit ${group.name}` : "New email group"}</h3>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mobile leads" className="w-64" autoFocus disabled={!canEdit} />
      </label>
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">Who&apos;s in it · Flaw Patrol members or any email address</span>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 p-1.5">
          {members.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-900">
              {m.name}
              <button type="button" aria-label={`Remove ${m.name}`} onClick={() => setMembers((x) => x.filter((y) => y.id !== m.id))}>
                ✕
              </button>
            </span>
          ))}
          {addresses.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {a}
              <button type="button" aria-label={`Remove ${a}`} onClick={() => setAddresses((x) => x.filter((y) => y !== a))}>
                ✕
              </button>
            </span>
          ))}
          <input
            aria-label="Add a person or address"
            className="min-w-48 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
            placeholder="Add a person or address…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches.length === 1 && !typed) add(matches[0]);
                else addTyped();
              }
            }}
          />
        </div>
        {(matches.length > 0 || (typed && !matches.some((m) => m.email.toLowerCase() === typed))) && (
          <ul className="mt-1 rounded-md border border-slate-200 bg-white text-sm shadow-sm">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full gap-2 px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => add(p)}>
                  {p.name} <span className="text-xs text-slate-500">{p.email}</span>
                </button>
              </li>
            ))}
            {typed && !matches.some((m) => m.email.toLowerCase() === typed) && (
              <li>
                <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={addTyped}>
                  Add {typed}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {group && <p className="text-xs text-slate-500">Used by: {group.usedBy.length ? joinAnd(group.usedBy) : "nothing yet"}</p>}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={pending || !name.trim()} onClick={save}>
          {group ? "Save" : "Save group"}
        </Button>
        <Button size="sm" onClick={() => onDone(null)}>
          Cancel
        </Button>
        {group && isAdmin && !confirm && (
          <Button size="sm" variant="ghost" className="ml-auto text-red-700" onClick={() => setConfirm(true)}>
            Delete group
          </Button>
        )}
      </div>
      {group && confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          Delete {group.name}? {group.usedBy.length ? `${joinAnd(group.usedBy)} stop sending to it.` : "Nothing uses it yet."}
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteEmailGroup(group.id);
                if (!r.ok) return setError(r.error);
                router.refresh();
                onDeleted?.(group.id);
              })
            }
          >
            Delete
          </Button>
          <Button size="sm" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/** Workspace settings → Email → Email groups. */
export function EmailGroupsCard({ groups, people, isAdmin }: { groups: GroupView[]; people: PersonView[]; isAdmin: boolean }) {
  const [editing, setEditing] = useState<GroupView | "new" | null>(null);
  return (
    <Card id="email-groups" className="scroll-mt-28 space-y-3 p-5" role="region" aria-labelledby="email-groups-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-groups-heading" className="flex items-center gap-1 text-sm font-semibold text-slate-800">
          Email groups <InfoTip text="A saved list of people and addresses with a name. Use it in any umbrella's Email digests. Change who's in it once, and every umbrella that uses it follows. Anyone can make or edit one; only admins delete one." />
        </h2>
        {!editing && (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            ＋ New email group
          </Button>
        )}
      </div>
      {editing === "new" && (
        <div className="rounded-md border border-slate-200 p-3">
          <GroupEditor group={null} people={people} isAdmin={isAdmin} onDone={() => setEditing(null)} />
        </div>
      )}
      {groups.length === 0 && editing !== "new" && <p className="text-sm text-slate-500">No email groups yet. Make one here, or with ＋ New email group… in an umbrella&apos;s Email digests.</p>}
      {groups.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {groups.map((g) =>
            editing !== "new" && editing?.id === g.id ? (
              <li key={g.id} className="p-3">
                <GroupEditor group={g} people={people} isAdmin={isAdmin} onDone={() => setEditing(null)} onDeleted={() => setEditing(null)} />
              </li>
            ) : (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{g.name}</span>
                <span className="min-w-0 flex-1 text-xs text-slate-500">
                  {groupLine(g)} · {g.usedBy.length ? `used by ${joinAnd(g.usedBy)}` : "not used yet"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
                  Edit
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

/** A test cycle in an umbrella: Same as the umbrella (default), its own choice, or Off. */
export function CycleDigest({ projectId, mode, umbrella, umbrellaSummary, canManage, own, isAdmin, team }: { projectId: string; mode: "umbrella" | "choose" | "off"; umbrella: string; umbrellaSummary: string; canManage: boolean; own: DigestCardData; isAdmin: boolean; team: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = { umbrella: `Following ${umbrella}`, choose: "Own choice", off: "Off" }[mode];
  const options = [
    { id: "umbrella" as const, label: `Same as ${umbrella} (default)`, tip: `${umbrella}'s choice: ${umbrellaSummary}` },
    { id: "choose" as const, label: "Choose for this test cycle", tip: "Pick who gets this test cycle's digests, starting from the umbrella's choice." },
    { id: "off" as const, label: "Off for this test cycle", tip: "No digest emails from this test cycle." },
  ];
  return (
    <>
      <Card className="space-y-3 p-5" role="region" aria-label="Email digests for this test cycle">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          Email digests <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{label}</span>
        </h2>
        {!canManage ? (
          <p className="text-sm text-slate-600">{mode === "off" ? "No digest emails from this test cycle." : mode === "umbrella" ? umbrellaSummary : own.summary}</p>
        ) : (
          <>
            <fieldset className="space-y-1.5 text-sm">
              <legend className="sr-only">Email digests for this test cycle</legend>
              {options.map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`cycle-digest-${projectId}`} checked={choice === o.id} onChange={() => setChoice(o.id)} />
                    {o.label}
                  </label>
                  <InfoTip text={o.tip} />
                </div>
              ))}
            </fieldset>
            <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || choice === mode}
              onClick={() =>
                start(async () => {
                  const r = await setCycleDigest(projectId, choice);
                  if (!r.ok) return setError(r.error);
                  setError(null);
                  router.refresh();
                })
              }
            >
              Save
            </Button>
          </>
        )}
      </Card>
      {mode === "choose" && <DigestCard target={{ projectId }} data={own} canManage={canManage} team={team} isAdmin={isAdmin} id={`email-digests-${projectId}`} />}
    </>
  );
}
