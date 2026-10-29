"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CASES_MIME, dragChip, FOLDER_MIME, type DraggedCases } from "@/lib/case-drag";
import { flattenTree, type FolderNode } from "@/lib/folders";
import { moveCases } from "@/server/cases";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "@/server/folders";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Select } from "./ui";

type Editing = { mode: "new"; parentId: string | null } | { mode: "rename"; id: string; name: string } | null;

export function FolderTree({
  projectId,
  projectKey,
  tree,
  counts,
  robots,
  selected,
  canManage,
  canDelete = canManage,
  canMoveCases = false,
}: {
  projectId: string;
  projectKey: string;
  tree: FolderNode[];
  counts: Record<string, number>;
  /** Cases automation runs, per folder (ver_95): shown as 🤖 next to the count. */
  robots?: Record<string, number>;
  selected: string | null;
  canManage: boolean;
  canDelete?: boolean;
  /** Cases dragged from the table can be dropped on a folder. */
  canMoveCases?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  // The folder a drag is hovering over ("" = the top level), and the last move, which can be undone.
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ text: string; undo: DraggedCases } | null>(null);
  const [movingFolder, setMovingFolder] = useState<FolderNode | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const base = `/p/${projectKey}/cases`;

  const total = (n: FolderNode): number => (counts[n.id] ?? 0) + n.children.reduce((s, c) => s + total(c), 0);
  const bots = (n: FolderNode): number => (robots?.[n.id] ?? 0) + n.children.reduce((s, c) => s + bots(c), 0);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  const submit = (value: string) => {
    const name = value.trim();
    if (!editing || !name) return setEditing(null);
    start(async () => {
      const res =
        editing.mode === "new"
          ? await createFolder(projectId, editing.parentId, name)
          : await renameFolder(projectId, editing.id, name);
      if (!res.ok) return setError(res.error);
      setError(null);
      setEditing(null);
      if (editing.mode === "new" && editing.parentId) {
        setCollapsed((c) => {
          const n = new Set(c);
          n.delete(editing.parentId!);
          return n;
        });
      }
      router.refresh();
    });
  };

  const remove = (node: FolderNode) => {
    const n = total(node);
    const msg = `Delete "${node.name}"${node.children.length ? " and its subfolders" : ""}?` + (n ? ` Its ${n} cases move up a level.` : "");
    if (!confirm(msg)) return;
    start(async () => {
      const res = await deleteFolder(projectId, node.id);
      if (!res.ok) return setError(res.error);
      if (selected === node.id) router.push(res.parentId ? `${base}?folder=${res.parentId}` : base);
      router.refresh();
    });
  };

  const all_ = flattenTree(tree);
  const nameOf = (id: string | null) => (id ? (all_.find((f) => f.id === id)?.name ?? "") : "");
  const inside = (id: string, ancestor: string): boolean => {
    for (let f = all_.find((x) => x.id === id); f; f = f.parentId ? all_.find((x) => x.id === f!.parentId) : undefined) if (f.id === ancestor) return true;
    return false;
  };
  const kindOf = (e: React.DragEvent) => (e.dataTransfer.types.includes(CASES_MIME) ? "cases" : e.dataTransfer.types.includes(FOLDER_MIME) ? "folder" : null);

  const placeFolder = (folderId: string, parentId: string | null) =>
    start(async () => {
      const res = await moveFolder(projectId, folderId, parentId);
      if (!res.ok) return setError(res.error);
      setError(null);
      setMovingFolder(null);
      if (parentId)
        setCollapsed((c) => {
          const n = new Set(c);
          n.delete(parentId);
          return n;
        });
      router.refresh();
    });

  /** Drop handlers for a folder row; target null = the top level (folders) or no folder (cases). */
  const dropTarget = (target: string | null, accepts: ("cases" | "folder")[], spot = target ?? "") => ({
    onDragOver: (e: React.DragEvent) => {
      const kind = kindOf(e);
      if (!kind || !accepts.includes(kind) || (kind === "cases" && !canMoveCases) || (kind === "folder" && !canManage)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropOn(spot);
    },
    onDragLeave: () => setDropOn((d) => (d === spot ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const cases = e.dataTransfer.getData(CASES_MIME);
      const folder = e.dataTransfer.getData(FOLDER_MIME);
      if (cases && accepts.includes("cases")) {
        const list = (JSON.parse(cases) as DraggedCases).filter((c) => c.folderId !== target);
        if (!list.length) return;
        start(async () => {
          const res = await moveCases(projectId, list.map((c) => c.id), target);
          if (!res.ok) return setError(res.error);
          setError(null);
          setMoved({ text: `Moved ${res.count} ${res.count === 1 ? "case" : "cases"} to ${target ? nameOf(target) : "no folder"}.`, undo: list });
          router.refresh();
        });
      } else if (folder && accepts.includes("folder")) {
        if (folder === target) return;
        if (target && inside(target, folder)) return setError("A folder can't go inside itself.");
        placeFolder(folder, target);
      }
    },
  });

  const undoMove = () => {
    if (!moved) return;
    const back = new Map<string | null, string[]>();
    for (const c of moved.undo) back.set(c.folderId, [...(back.get(c.folderId) ?? []), c.id]);
    setMoved(null);
    start(async () => {
      for (const [folderId, ids] of back) {
        const res = await moveCases(projectId, ids, folderId);
        if (!res.ok) return setError(res.error);
      }
      router.refresh();
    });
  };

  const nameInput = (initial: string, depth: number) => (
    <input
      autoFocus
      defaultValue={initial}
      placeholder="Folder name"
      className="my-0.5 h-7 w-full rounded border border-accent-500 px-2 text-sm outline-none"
      style={{ marginLeft: depth * 12 }}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit(e.currentTarget.value);
        if (e.key === "Escape") setEditing(null);
      }}
      onBlur={(e) => submit(e.currentTarget.value)}
    />
  );

  const row = (node: FolderNode) => {
    const isOpen = !collapsed.has(node.id);
    const renaming = editing?.mode === "rename" && editing.id === node.id;
    return (
      <li key={node.id}>
        {renaming ? (
          nameInput(node.name, node.depth)
        ) : (
          <div
            className={cx(
              "group flex items-center rounded-md pr-1 text-sm outline-offset-[-1px]",
              selected === node.id ? "bg-accent-50 text-accent-700" : "text-slate-700 hover:bg-slate-100",
              dropOn === node.id && "bg-accent-50 outline-2 outline-dashed outline-accent-500",
            )}
            style={{ paddingLeft: node.depth * 12 }}
            data-folder={node.name}
            draggable={canManage}
            onDragStart={(e) => {
              e.dataTransfer.setData(FOLDER_MIME, node.id);
              e.dataTransfer.effectAllowed = "move";
              dragChip(e, `Move "${node.name}"`);
            }}
            {...dropTarget(node.id, ["cases", "folder"])}
          >
            <button
              type="button"
              aria-label={isOpen ? "Collapse" : "Expand"}
              className={cx("w-5 shrink-0 text-xs text-slate-400", !node.children.length && "invisible")}
              onClick={() =>
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(node.id)) n.delete(node.id);
                  else n.add(node.id);
                  return n;
                })
              }
            >
              {isOpen ? "▾" : "▸"}
            </button>
            <Link href={`${base}?folder=${node.id}`} draggable={false} className="min-w-0 flex-1 truncate py-1">
              {node.name}
            </Link>
            {canManage && (
              <span className="hidden gap-0.5 group-hover:flex">
                <IconBtn label="New subfolder" onClick={() => setEditing({ mode: "new", parentId: node.id })}>
                  +
                </IconBtn>
                <IconBtn label="Rename" onClick={() => setEditing({ mode: "rename", id: node.id, name: node.name })}>
                  ✎
                </IconBtn>
                <IconBtn
                  label="Move folder…"
                  onClick={() => {
                    setMovingFolder(node);
                    setMoveTo(node.parentId ?? "");
                  }}
                >
                  ⇄
                </IconBtn>
                {canDelete && (
                  <IconBtn label="Delete" onClick={() => remove(node)}>
                    ×
                  </IconBtn>
                )}
              </span>
            )}
            <span className="ml-1 text-xs whitespace-nowrap text-slate-400 group-hover:hidden" title={bots(node) ? `${bots(node)} run by automation` : undefined}>
              {bots(node) > 0 && bots(node) === total(node) ? "🤖 " : ""}
              {total(node) || ""}
            </span>
          </div>
        )}
        {(isOpen || (editing?.mode === "new" && editing.parentId === node.id)) && (
          <ul>
            {node.children.map(row)}
            {editing?.mode === "new" && editing.parentId === node.id && <li>{nameInput("", node.depth + 1)}</li>}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-2 shadow-sm">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Folders</span>
        {canManage && (
          <button
            type="button"
            className="rounded px-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={() => setEditing({ mode: "new", parentId: null })}
          >
            + New
          </button>
        )}
      </div>
      {error && <div className="mx-1 mb-1 text-xs"><ErrorText onDismiss={() => setError(null)}>{error}</ErrorText></div>}
      <ul>
        <li>
          <Link
            href={base}
            className={cx(
              "flex items-center justify-between rounded-md py-1 pr-1 pl-5 text-sm outline-offset-[-1px]",
              !selected ? "bg-accent-50 font-medium text-accent-700" : "text-slate-700 hover:bg-slate-100",
              dropOn === "top" && "outline-2 outline-dashed outline-accent-500",
            )}
            title={canManage ? "Drop a folder here to move it to the top level" : undefined}
            {...dropTarget(null, ["folder"], "top")}
          >
            All cases <span className="text-xs text-slate-400">{all || ""}</span>
          </Link>
        </li>
        {tree.map(row)}
        {editing?.mode === "new" && editing.parentId === null && <li>{nameInput("", 0)}</li>}
        {(counts.unfiled ?? 0) > 0 && (
          <li>
            <Link
              href={`${base}?folder=unfiled`}
              className={cx(
                "flex items-center justify-between rounded-md py-1 pr-1 pl-5 text-sm italic outline-offset-[-1px]",
                selected === "unfiled" ? "bg-accent-50 text-accent-700" : "text-slate-500 hover:bg-slate-100",
                dropOn === "unfiled" && "outline-2 outline-dashed outline-accent-500",
              )}
              {...dropTarget(null, ["cases"], "unfiled")}
            >
              Unfiled <span className="text-xs not-italic text-slate-400">{counts.unfiled}</span>
            </Link>
          </li>
        )}
      </ul>
      {movingFolder && (
        <Modal open onClose={() => setMovingFolder(null)} title={`Move "${movingFolder.name}"`}>
          <p className="mb-3 text-sm text-slate-600">
            Moves the folder, its subfolders and its {total(movingFolder)} {total(movingFolder) === 1 ? "case" : "cases"}. Runs and history are not affected.
          </p>
          <Select aria-label="Move it into" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">(Top level)</option>
            {all_
              .filter((f) => f.id !== movingFolder.id && !inside(f.id, movingFolder.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {"\u00a0\u00a0".repeat(f.depth) + f.name}
                </option>
              ))}
          </Select>
          <p className="mt-2 text-xs text-slate-500">You can also drag a folder onto another folder in the tree.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setMovingFolder(null)}>Cancel</Button>
            <Button variant="primary" disabled={moveTo === (movingFolder.parentId ?? "")} onClick={() => placeFolder(movingFolder.id, moveTo || null)}>
              Move folder
            </Button>
          </div>
        </Modal>
      )}
      {moved && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-accent-100 bg-surface px-4 py-2.5 text-sm text-slate-800 shadow-lg">
          {moved.text}
          <button type="button" className="font-semibold text-accent-700 hover:underline" onClick={undoMove}>
            Undo
          </button>
          <button type="button" aria-label="Dismiss" className="text-slate-400 hover:text-slate-700" onClick={() => setMoved(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="h-5 w-5 rounded text-xs text-slate-500 hover:bg-surface hover:text-slate-900"
    >
      {children}
    </button>
  );
}
