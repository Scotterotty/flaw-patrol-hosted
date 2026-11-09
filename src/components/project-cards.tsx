"use client";

import type { Role } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { moveBefore, type ProjectItem } from "@/lib/project-list";
import { deleteProject } from "@/server/projects";
import { RoleBadge } from "./badges";
import { MoveToGroup } from "./group-dialogs";
import { useMenuPlace } from "./menu-place";
import { MoveIntoUmbrella } from "./umbrella-ui";
import { Modal } from "./modal";
import { Button, Card, cx, ErrorText, Input } from "./ui";

export type ProjectCardData = ProjectItem & {
  kind?: undefined;
  role: Role;
  cases: number;
  members: number;
  activeRuns: number;
  /** Bug bashes going on now: shown on their own, not counted as runs. */
  liveBashes?: number;
  /** Every run, open or closed, for the delete warning. */
  runs: number;
  /** "Active 2 h ago", worked out on the server so it renders the same everywhere. */
  activity: string;
};

/** A project group's card: id is "g:<group id>" so it can share a section's order with projects. */
export type GroupCardData = ProjectItem & {
  kind: "group";
  /** The group's real id. */
  group: string;
  /** Its projects the viewer can see, archived ones included. */
  projectIds: string[];
};

export type Item = ProjectCardData | GroupCardData;

/** One section the viewer can reorder: its ids top first, and how to save a new order. */
export type Sortable = { ids: string[]; move: (ids: string[]) => void };

export type CardActions = {
  starGroup: (g: GroupCardData) => void;
  groups: { id: string; name: string }[];
  umbrellas: { id: string; name: string }[];
  canManageGroups: boolean;
  star: (p: ProjectCardData) => void;
  hide: (p: ProjectCardData) => void;
  archive: (p: ProjectCardData) => void;
  deleted: () => void;
};

// The card being dragged, shared by every card on the page.
let dragging: string | null = null;

export function OrganizeCard({
  project: p,
  actions,
  section,
}: {
  project: ProjectCardData;
  actions: CardActions;
  section?: Sortable;
}) {
  const archived = p.archivedAt !== null;
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [sheltering, setSheltering] = useState(false);
  const { over, dropProps, handle, moveTo } = useDrag(p, section, ref);
  // No new groups are made; projects can still move between the ones that exist.
  const canGroup =
    (p.role === "ADMIN" || p.role === "LEAD" || p.role === "TESTER") && actions.groups.length > 0;
  const canShelter =
    p.role === "ADMIN" &&
    actions.umbrellas.length > 0 &&
    !actions.umbrellas.some((u) => u.id === p.groupId);

  return (
    <Card
      ref={ref}
      className={cx(
        "relative h-full p-4 transition hover:border-accent-500 hover:shadow",
        archived && "opacity-75",
        menu && "z-30",
        over && "border-accent-500 ring-2 ring-accent-500/40",
      )}
      title={p.description || undefined}
      {...dropProps}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {handle}
          <span className="font-mono text-xs font-semibold text-accent-700">
            {p.key}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {archived && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
              Archived
            </span>
          )}
          <RoleBadge role={p.role} />
          <button
            type="button"
            onClick={() => actions.star(p)}
            aria-pressed={p.starred}
            aria-label={p.starred ? `Unstar ${p.name}` : `Star ${p.name}`}
            title={p.starred ? "Unstar" : "Star to keep it at the top"}
            className={cx(
              "relative z-10 -my-1 min-w-6 rounded p-1 text-base leading-none transition hover:bg-slate-100",
              p.starred
                ? "text-amber-500"
                : "text-slate-300 hover:text-amber-500",
            )}
          >
            {p.starred ? "★" : "☆"}
          </button>
          <CardMenu
            name={p.name}
            open={menu}
            setOpen={setMenu}
            items={[
              section && {
                label: "Move to top",
                run: () => moveTo(true),
                disabled: section.ids[0] === p.id,
              },
              section && {
                label: "Move to bottom",
                run: () => moveTo(false),
                disabled: section.ids.at(-1) === p.id,
              },
              canShelter && {
                label: "Move into an umbrella…",
                hint: "Joins its team and Case library",
                run: () => setSheltering(true),
                divider: !!section,
              },
              canGroup && {
                label:
                  p.groupId &&
                  !actions.umbrellas.some((u) => u.id === p.groupId)
                    ? "Move to another group…"
                    : "Move to group…",
                hint: "Groups are shared with everyone",
                run: () => setGrouping(true),
                divider: !!section && !canShelter,
              },
              {
                label: p.hidden ? "Show again" : "Hide for me",
                hint: p.hidden
                  ? "Back on your Umbrellas page"
                  : "Only you stop seeing it",
                run: () => actions.hide(p),
                divider: !!section && !canGroup && !canShelter,
              },
              p.role === "ADMIN" && {
                label: archived ? "Restore" : "Archive",
                hint: archived
                  ? "Back for everyone"
                  : "Tucked away for everyone, kept safe",
                run: () => actions.archive(p),
              },
              p.role === "ADMIN" && {
                label: "Delete test cycle…",
                hint: "Can't be undone",
                run: () => setDeleting(true),
                danger: true,
                divider: true,
              },
            ]}
          />
        </span>
      </div>
      <h3 className="mt-1 font-semibold text-slate-900">
        <Link
          href={`/p/${p.key}`}
          draggable={false}
          className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-500"
        >
          {p.name}
        </Link>
      </h3>
      <CardStats project={p} />
      {deleting && (
        <DeleteProject
          project={p}
          onClose={() => setDeleting(false)}
          onDeleted={actions.deleted}
        />
      )}
      {grouping && (
        <MoveToGroup
          project={{ id: p.id, name: p.name, groupId: p.groupId ?? null }}
          groups={actions.groups}
          onClose={() => setGrouping(false)}
          onMoved={actions.deleted}
        />
      )}
      {sheltering && (
        <MoveIntoUmbrella
          project={p}
          umbrellas={actions.umbrellas}
          onClose={() => setSheltering(false)}
          onMoved={actions.deleted}
        />
      )}
    </Card>
  );
}

/** Dragging a card (project or group) within its section: the ⋮⋮ handle, the drop target, and Move to top/bottom. */
function useDrag(
  p: Item,
  section: Sortable | undefined,
  ref: React.RefObject<HTMLDivElement | null>,
) {
  const [over, setOver] = useState(false);
  const accepts = () =>
    !!section &&
    !!dragging &&
    dragging !== p.id &&
    section.ids.includes(dragging);
  const drop = (e: React.DragEvent) => {
    setOver(false);
    if (!section || !accepts()) return;
    e.preventDefault();
    // Dropped on a card further down: land after it; further up: land before it.
    const ids = section.ids;
    const after = ids.indexOf(dragging!) < ids.indexOf(p.id);
    const next = ids[ids.indexOf(p.id) + 1] ?? null;
    section.move(moveBefore(ids, dragging!, after ? next : p.id));
    dragging = null;
  };
  const moveTo = (top: boolean) =>
    section &&
    section.move(moveBefore(section.ids, p.id, top ? section.ids[0] : null));
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (accepts()) {
        e.preventDefault();
        setOver(true);
      }
    },
    onDragLeave: () => setOver(false),
    onDrop: drop,
  };
  const handle = section && (
    <span
      draggable
      onDragStart={(e) => {
        dragging = p.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.key || p.name);
        if (ref.current) e.dataTransfer.setDragImage(ref.current, 16, 16);
      }}
      onDragEnd={() => (dragging = null)}
      className="relative z-10 -ml-1 flex-none cursor-grab rounded px-0.5 pr-1 text-sm leading-none tracking-[-3px] text-slate-400 select-none hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
      title="Drag to move"
      aria-label={`Drag to move ${p.name}`}
    >
      ⋮⋮
    </span>
  );
  return { over, dropProps, handle, moveTo };
}

/**
 * A project group as one card, drawn as a little stack. Click it to open the group
 * page; each chip goes straight into that project.
 */
export function GroupCard({
  group: g,
  projects,
  actions,
  section,
}: {
  group: GroupCardData;
  projects: ProjectCardData[];
  actions: CardActions;
  section?: Sortable;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const { over, dropProps, handle, moveTo } = useDrag(g, section, ref);
  const live = projects.filter((p) => p.archivedAt === null);
  const archivedCount = projects.length - live.length;
  const activeRuns = live.reduce((n, p) => n + p.activeRuns, 0);
  const liveBashes = live.reduce((n, p) => n + (p.liveBashes ?? 0), 0);
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div className={cx("relative h-full pr-1.5 pb-1.5", menu && "z-30")}>
      {/* The stack behind the card. */}
      <div
        className="absolute inset-0 top-1.5 left-1.5 rounded-lg border-2 border-accent-100 bg-accent-50"
        aria-hidden
      />
      <Card
        ref={ref}
        className={cx(
          "relative h-full border-2 border-accent-500 p-4 transition hover:border-accent-500 hover:shadow",
          over && "border-accent-500 ring-2 ring-accent-500/40",
        )}
        title={g.description || undefined}
        {...dropProps}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {handle}
            <span className="text-xs font-semibold text-accent-700">
              Group · {plural(projects.length, "test cycle")}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => actions.starGroup(g)}
              aria-pressed={g.starred}
              aria-label={g.starred ? `Unstar ${g.name}` : `Star ${g.name}`}
              title={g.starred ? "Unstar" : "Star to keep it at the top"}
              className={cx(
                "relative z-10 -my-1 min-w-6 rounded p-1 text-base leading-none transition hover:bg-slate-100",
                g.starred
                  ? "text-amber-500"
                  : "text-slate-300 hover:text-amber-500",
              )}
            >
              {g.starred ? "★" : "☆"}
            </button>
            <CardMenu
              name={g.name}
              open={menu}
              setOpen={setMenu}
              items={[
                section && {
                  label: "Move to top",
                  run: () => moveTo(true),
                  disabled: section.ids[0] === g.id,
                },
                section && {
                  label: "Move to bottom",
                  run: () => moveTo(false),
                  disabled: section.ids.at(-1) === g.id,
                },
                {
                  label: "Open group",
                  run: () => router.push(`/g/${g.group}`),
                  divider: !!section,
                },
                actions.canManageGroups && {
                  label: "Rename or edit group…",
                  hint: "Name, description and test cycles",
                  run: () => router.push(`/g/${g.group}?edit=1`),
                },
              ]}
            />
          </span>
        </div>
        <h3 className="mt-1 font-semibold text-slate-900">
          <Link
            href={`/g/${g.group}`}
            draggable={false}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-500"
          >
            <span aria-hidden>📁 </span>
            {g.name}
          </Link>
        </h3>
        <div className="mt-2 flex flex-wrap gap-1">
          {live.slice(0, 6).map((p) => (
            <Link
              key={p.id}
              href={`/p/${p.key}`}
              draggable={false}
              className="relative z-10 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:border-accent-500 hover:text-accent-700"
              title={`Open ${p.name}`}
            >
              {p.name}
            </Link>
          ))}
          {live.length > 6 && (
            <span className="px-1 py-0.5 text-xs text-slate-500">
              +{live.length - 6} more
            </span>
          )}
          {projects.length === 0 && (
            <span className="text-xs text-slate-500">
              No test cycles yet. Use Edit group to add some.
            </span>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {activeRuns > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-800">
              <span
                className="size-1.5 rounded-full bg-accent-600"
                aria-hidden
              />
              {plural(activeRuns, "active run")}
            </span>
          ) : (
            <span className="text-slate-500">No active runs</span>
          )}
          {liveBashes > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-800" data-testid="live-bash-count">
              {plural(liveBashes, "live bug bash").replace(/bashs$/, "bashes")}
            </span>
          )}
          {archivedCount > 0 && (
            <span className="text-slate-500">{archivedCount} archived</span>
          )}
        </p>
      </Card>
    </div>
  );
}

function CardStats({ project: p }: { project: ProjectCardData }) {
  return (
    <>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {p.activeRuns > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-800">
            <span className="size-1.5 rounded-full bg-accent-600" aria-hidden />
            {p.activeRuns} active {p.activeRuns === 1 ? "run" : "runs"}
          </span>
        ) : (
          <span className="text-slate-500">No active runs</span>
        )}
        {(p.liveBashes ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-800" data-testid="live-bash-count">
            {p.liveBashes} live bug {p.liveBashes === 1 ? "bash" : "bashes"}
          </span>
        )}
        <span className="text-slate-500">{p.activity}</span>
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {p.cases} {p.cases === 1 ? "case" : "cases"} · {p.members}{" "}
        {p.members === 1 ? "member" : "members"}
      </p>
    </>
  );
}

type MenuItem = {
  label: string;
  hint?: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
};

export function CardMenu({
  name,
  open,
  setOpen,
  items,
  title = "Move, hide, archive or delete",
}: {
  name: string;
  open: boolean;
  setOpen: (o: boolean) => void;
  items: (MenuItem | false | undefined)[];
  title?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const place = useMenuPlace(open, box, list);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) =>
      !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, setOpen]);
  return (
    <span ref={box} className="relative z-10">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${name}`}
        title={title}
        onClick={() => setOpen(!open)}
        className="-m-1 rounded p-1 text-base leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        ⋯
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={`${name} options`}
          style={place}
          className="absolute top-full right-0 w-56 rounded-lg border border-slate-200 bg-surface p-1 text-sm shadow-lg"
        >
          {items.map(
            (it) =>
              it && (
                <div key={it.label}>
                  {it.divider && <div className="my-1 h-px bg-slate-200" />}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(false);
                      it.run();
                    }}
                    className={cx(
                      "block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
                      it.danger ? "text-red-700" : "text-slate-800",
                    )}
                  >
                    {it.label}
                    {it.hint && (
                      <span className="block text-[11px] text-slate-500">
                        {it.hint}
                      </span>
                    )}
                  </button>
                </div>
              ),
          )}
        </div>
      )}
    </span>
  );
}

function DeleteProject({
  project: p,
  onClose,
  onDeleted,
}: {
  project: ProjectCardData;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toUpperCase() === p.key;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <Modal open onClose={onClose} title={`Delete ${p.name}?`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!matches) return;
          setBusy(true);
          const r = await deleteProject(p.id, typed);
          setBusy(false);
          if (!r.ok)
            return setError(r.error ?? "Couldn't delete it. Try again.");
          onClose();
          onDeleted();
        }}
        className="space-y-3 text-sm text-slate-700"
      >
        <p>
          This permanently removes its {plural(p.cases, "case")},{" "}
          {plural(p.runs, "run")}, and all their results and attachments, for
          everyone. Bugs already in Jira stay there.
        </p>
        <p>
          If you might need it later, close this and choose Archive instead.
        </p>
        <label className="block">
          Type{" "}
          <code className="rounded bg-slate-100 px-1 font-mono font-semibold">
            {p.key}
          </code>{" "}
          to confirm
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            className="mt-1 font-mono"
            aria-label="Test cycle key to confirm"
          />
        </label>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={!matches || busy}>
            {busy ? "Deleting…" : "Delete forever"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
