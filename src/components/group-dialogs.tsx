"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteGroup, setProjectGroup, updateGroup } from "@/server/groups";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Input, Textarea } from "./ui";

/** A project you could tick in the group box. */
export type GroupChoice = { id: string; key: string; name: string; archived: boolean; groupId: string | null; groupName: string | null; canMove: boolean; cases?: number; suites?: number; inUmbrella?: boolean };

export type GroupInfo = { id: string; name: string; description: string };

/** "Edit group" on a group page. */
export function EditGroupButton({ group, choices, label = "Edit group" }: { group: GroupInfo; choices: GroupChoice[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {open && <GroupDialog group={group} choices={choices} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Rename an existing group, describe it, tick its projects, or delete it. */
export function GroupDialog({ group, choices, onClose }: { group: GroupInfo; choices: GroupChoice[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [ticked, setTicked] = useState(() => new Set(choices.filter((c) => group && c.groupId === group.id).map((c) => c.id)));
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const list = choices.filter((c) => showArchived || !c.archived || ticked.has(c.id));
  const archivedCount = choices.filter((c) => c.archived).length;
  const toggle = (id: string) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () =>
    start(async () => {
      const input = { name, description, projectIds: [...ticked] };
      const r = await updateGroup(group.id, input);
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await deleteGroup(group!.id);
      if (!r.ok) return setError(r.error);
      router.push("/");
    });

  return (
    <Modal open onClose={onClose} title={group ? `Edit ${group.name}` : "New group"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <Field label="Group name" htmlFor="gname">
          <Input id="gname" required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
        </Field>
        <Field label="Description (optional)" htmlFor="gdesc">
          <Textarea id="gdesc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this group holds" />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Test cycles in this group</legend>
          <p className="mb-2 text-xs text-slate-500">Everyone sees the group. A test cycle can be in one group, so ticking one that&apos;s in another group moves it here.</p>
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
            {list.length === 0 && <p className="p-2 text-sm text-slate-500">No test cycles yet.</p>}
            {list.map((c) => (
              <label
                key={c.id}
                className={cx("flex items-center gap-2 rounded px-2 py-1.5 text-sm", c.canMove ? "cursor-pointer hover:bg-slate-100" : "cursor-not-allowed opacity-60")}
                title={c.canMove ? undefined : "Viewers can't move test cycles"}
              >
                <input type="checkbox" checked={ticked.has(c.id)} disabled={!c.canMove} onChange={() => toggle(c.id)} className="accent-accent-600" />
                <span className="font-mono text-xs font-semibold text-accent-700">{c.key}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">{c.name}</span>
                {c.archived && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">Archived</span>}
                {c.groupName && c.groupId !== group?.id && <span className="text-[11px] text-slate-500">in {c.groupName}</span>}
              </label>
            ))}
          </div>
          {archivedCount > 0 && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-accent-600" />
              Show archived test cycles ({archivedCount})
            </label>
          )}
        </fieldset>
        <div className="flex items-center gap-2">
          {group &&
            (confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-700">Delete the group? Its test cycles stay, just ungrouped.</span>
                <Button variant="danger" onClick={remove} disabled={pending}>
                  Delete group
                </Button>
                <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-red-700 hover:underline">
                Delete group…
              </button>
            ))}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : group ? "Save" : "Make group"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Move to group…" from a project card's ⋯ menu: pick one of the existing groups, or take it out. */
export function MoveToGroup({
  project,
  groups,
  onClose,
  onMoved,
}: {
  project: { id: string; name: string; groupId: string | null };
  groups: { id: string; name: string }[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const [choice, setChoice] = useState<string>(project.groupId && groups.some((g) => g.id === project.groupId) ? project.groupId : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const option = "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-100";
  return (
    <Modal open onClose={onClose} title={`Move ${project.name} to a group`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await setProjectGroup(project.id, choice || null);
            if (!r.ok) return setError(r.error);
            onClose();
            onMoved();
          });
        }}
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1" role="radiogroup" aria-label="Group">
          {groups.map((g) => (
            <label key={g.id} className={option}>
              <input type="radio" name="group" checked={choice === g.id} onChange={() => setChoice(g.id)} className="accent-accent-600" />
              <span aria-hidden>📁</span> {g.name}
              {g.id === project.groupId && <span className="text-[11px] text-slate-500">(now)</span>}
            </label>
          ))}
          <label className={option}>
            <input type="radio" name="group" checked={choice === ""} onChange={() => setChoice("")} className="accent-accent-600" />
            <span className="text-slate-600">No group</span>
          </label>
        </div>
        <p className="text-xs text-slate-500">New groups can&apos;t be made anymore. For new work, use an umbrella.</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending || choice === (project.groupId ?? "")}>
            {pending ? "Moving…" : "Move"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
