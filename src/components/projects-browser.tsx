"use client";

import { CloseMatchesLabel } from "./close-matches";
import { matchCount } from "@/lib/fuzzy";
import type { Role } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  arrange,
  arrangeUmbrellas,
  CROWDED,
  findRowsForgiving,
  moveBefore,
  moveUmbrella,
  UMBRELLA_SORT_COOKIE,
  UMBRELLA_SORTS,
  type FindRow,
  type FindScope,
  type ProjectItem,
  type UmbrellaItem,
  type UmbrellaSort,
} from "@/lib/project-list";
import { setGroupsHidden, setGroupStarred } from "@/server/groups";
import { setUmbrellaArchived } from "@/server/umbrella";
import {
  deleteProject,
  setArchived,
  setHidden,
  setProjectOrder,
  setStarred,
} from "@/server/projects";
import { RoleBadge } from "./badges";
import { MoveToGroup } from "./group-dialogs";
import { useMenuPlace } from "./menu-place";
import {
  MoveIntoUmbrella,
  UmbrellaCard,
  type UmbrellaCardData,
} from "./umbrella-ui";
import { Modal } from "./modal";
import {
  Button,
  buttonClass,
  Card,
  cx,
  ErrorText,
  InfoTip,
  Input,
  PageHeader,
  Select,
} from "./ui";

export type ProjectCardData = ProjectItem & {
  kind?: undefined;
  role: Role;
  cases: number;
  members: number;
  activeRuns: number;
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

type Item = ProjectCardData | GroupCardData;

/** An umbrella card on the page, with the viewer's star and place, and its test cycles for search. */
export type UmbrellaEntry = UmbrellaCardData &
  UmbrellaItem & {
    cycles: { id: string; key: string; name: string; archived: boolean }[];
    /** Hidden from the viewer's page (ver_94). */
    hidden: boolean;
    /** The viewer may archive it (admins). */
    canArchive: boolean;
  };

type Props = {
  subtitle: string;
  /** Runs with cases assigned to the viewer that still need testing. */
  yourWork?: { href: string; run: string; cycle: string; left: number }[];
  /** New umbrella, for workspace admins. */
  newButton: React.ReactNode;
  sort: UmbrellaSort;
  umbrellaCards: UmbrellaEntry[];
  projects: ProjectCardData[];
  groups: GroupCardData[];
  canManageGroups: boolean;
  /** Umbrellas a project can move into (workspace admins only). */
  umbrellas: { id: string; name: string }[];
  /** Umbrellas show above, so the projects outside them get their own heading. */
  looseHeading?: boolean;
};

/** One section the viewer can reorder: its ids top first, and how to save a new order. */
type Sortable = { ids: string[]; move: (ids: string[]) => void };

/** The Umbrellas page: search, Starred, Recent, the rest, and Archived and Hidden tucked away. */
export function ProjectsBrowser({
  subtitle,
  yourWork = [],
  newButton,
  sort: savedSort,
  umbrellaCards,
  projects,
  groups,
  canManageGroups,
  umbrellas,
  looseHeading = false,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FindScope>("all");
  const [sort, setSortState] = useState<UmbrellaSort>(savedSort);
  const setSort = (v: UmbrellaSort) => {
    setSortState(v);
    // Remembered per browser; the page reads it back on the server.
    document.cookie = `${UMBRELLA_SORT_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  };
  // Changes shown straight away, before the page reloads from the server.
  const [local, setLocal] = useState<Record<string, Partial<ProjectItem>>>({});
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  // Umbrellas ticked for Hide for me or Archive… (ver_94).
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [archiving, setArchiving] = useState(false);
  const [busy, startBusy] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const pending = useRef(0);

  // "/" jumps to search, like many apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) &&
        !t.isContentEditable
      ) {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const projectItems = projects.map((p) => ({ ...p, ...local[p.id] }));
  const items: Item[] = [
    ...projectItems,
    ...groups.map((g) => ({ ...g, ...local[g.id] })),
  ];
  const byId = new Map(projectItems.map((p) => [p.id, p]));
  const groupOptions = groups.map((g) => ({ id: g.group, name: g.name }));
  const change = (
    patch: Record<string, Partial<ProjectItem>>,
    save: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setLocal((l) => {
      const next = { ...l };
      for (const [id, v] of Object.entries(patch))
        next[id] = { ...next[id], ...v };
      return next;
    });
    setError(null);
    pending.current++;
    start(async () => {
      const r = await save();
      if (!r.ok) setError(r.error ?? "That didn't save. Try again.");
      // Drop the local copies only once every save is in and the server's version has arrived.
      if (--pending.current > 0) return;
      start(() => {
        router.refresh();
        setLocal({});
      });
    });
  };

  const actions: CardActions = {
    star: (p) =>
      change({ [p.id]: { starred: !p.starred } }, () =>
        setStarred(p.id, !p.starred),
      ),
    hide: (p) =>
      change({ [p.id]: { hidden: !p.hidden } }, () =>
        setHidden(p.id, !p.hidden),
      ),
    archive: (p) =>
      change(
        { [p.id]: { archivedAt: p.archivedAt === null ? Date.now() : null } },
        () => setArchived(p.id, p.archivedAt === null),
      ),
    deleted: () => router.refresh(),
    starGroup: (g) =>
      change({ [g.id]: { starred: !g.starred } }, () =>
        setGroupStarred(g.group, !g.starred),
      ),
    groups: groupOptions,
    umbrellas,
    canManageGroups,
  };
  const sortable = (list: Item[]): Sortable => ({
    ids: list.map((p) => p.id),
    move: (ids) =>
      change(
        Object.fromEntries(ids.map((id, position) => [id, { position }])),
        () => setProjectOrder(ids),
      ),
  });
  const resetOrder = () =>
    change(
      Object.fromEntries(items.map((p) => [p.id, { position: null }])),
      () => setProjectOrder([]),
    );

  const { starred, recent, rest, archived, hidden, crowded } = arrange(items);
  const umbrellaItems = umbrellaCards.map(
    (u) => ({ ...u, ...local[`g:${u.id}`] }) as UmbrellaEntry,
  );
  const liveUmbrellas = arrangeUmbrellas(
    umbrellaItems.filter((u) => !u.archived && !u.hidden),
    sort,
  );
  const hiddenUmbrellas = umbrellaItems
    .filter((u) => !u.archived && u.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
  const tickedUmbrellas = liveUmbrellas.filter((u) => ticked.has(u.id));
  const tick = (id: string, on: boolean) =>
    setTicked((t) => {
      const n = new Set(t);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const hideUmbrellas = (ids: string[], hidden: boolean) => {
    setTicked(new Set());
    setArchiving(false);
    change(
      Object.fromEntries(ids.map((id) => [`g:${id}`, { hidden }])),
      () => setGroupsHidden(ids, hidden),
    );
  };
  const archiveTicked = () =>
    startBusy(async () => {
      for (const u of tickedUmbrellas) {
        const r = await setUmbrellaArchived(u.id, true);
        if (!r.ok) {
          setError(r.error);
          break;
        }
      }
      setTicked(new Set());
      setArchiving(false);
      router.refresh();
    });
  const canArchiveTicked =
    tickedUmbrellas.length > 0 && tickedUmbrellas.every((u) => u.canArchive);
  const tickedCycles = tickedUmbrellas.reduce(
    (n, u) => n + u.cycles.filter((c) => !c.archived).length,
    0,
  );
  const archivedUmbrellas = umbrellaItems
    .filter((u) => u.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Moving an umbrella saves the whole shown order as the viewer's own, and switches the sort back to it.
  const placeUmbrella = (
    id: string,
    where: Parameters<typeof moveUmbrella>[2],
  ) => {
    const ids = moveUmbrella(liveUmbrellas, id, where);
    if (sort !== "mine") setSort("mine");
    change(
      Object.fromEntries(ids.map((x, position) => [`g:${x}`, { position }])),
      () => setProjectOrder(ids.map((x) => `g:${x}`)),
    );
  };
  const starUmbrella = (u: UmbrellaEntry) =>
    change({ [`g:${u.id}`]: { starred: !u.starred } }, () =>
      setGroupStarred(u.id, !u.starred),
    );
  // Search shows once the page holds 7 or more things, umbrellas included.
  const showSearch = items.length + umbrellaCards.length > CROWDED;
  const rows: FindRow[] = [
    ...umbrellaItems.map((u) => ({
      id: `u:${u.id}`,
      kind: "umbrella" as const,
      name: u.name,
      key: "",
      where: `Umbrella · ${u.cycles.length} ${u.cycles.length === 1 ? "test cycle" : "test cycles"}`,
      href: `/g/${u.id}`,
      archived: u.archived,
    })),
    ...umbrellaItems.flatMap((u) =>
      u.cycles.map((c) => ({
        id: c.id,
        kind: "cycle" as const,
        name: c.name,
        key: c.key,
        where: `in ${u.name}`,
        href: `/p/${c.key}`,
        archived: c.archived || u.archived,
      })),
    ),
    ...items
      .filter((p): p is ProjectCardData => p.kind !== "group")
      .map((p) => ({
        id: p.id,
        kind: "loose" as const,
        name: p.name,
        key: p.key,
        where: "Not in an umbrella",
        href: `/p/${p.key}`,
        archived: p.archivedAt !== null,
      })),
  ];
  const forgiving = query.trim() ? findRowsForgiving(rows, query, scope) : null;
  const found = forgiving?.exact ?? null;
  const closeFound = forgiving?.close ?? [];
  const cards = (list: Item[], section?: Sortable) =>
    list.map((p) =>
      p.kind === "group" ? (
        <GroupCard
          key={p.id}
          group={p}
          projects={p.projectIds.flatMap((id) => byId.get(id) ?? [])}
          actions={actions}
          section={section}
        />
      ) : (
        <OrganizeCard
          key={p.id}
          project={p}
          actions={actions}
          section={section}
        />
      ),
    );
  const ordered = items.some((p) => p.position !== null);

  const archivedCount = archivedUmbrellas.length + archived.length;

  return (
    <>
      <PageHeader
        title="Umbrellas"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {liveUmbrellas.length > 1 && (
              <label className="flex items-center gap-1.5 text-sm text-slate-500">
                Sort
                <Select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as UmbrellaSort)}
                  aria-label="Sort umbrellas"
                  className="w-auto"
                >
                  {UMBRELLA_SORTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {newButton}
          </div>
        }
      />
      <div className="space-y-6">
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

        {yourWork.length > 0 && (
          <Card className="ring-accent-500/30">
            <h2 className="px-4 pt-3 text-sm font-semibold text-slate-900">
              Your work
            </h2>
            <ul className="divide-y divide-slate-100">
              {yourWork.map((w, i) => (
                <li
                  key={w.href}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-900">{w.run}</span>
                    <span className="text-sm text-slate-500">
                      {" "}
                      · {w.cycle} · {w.left} {w.left === 1 ? "case" : "cases"}{" "}
                      waiting
                    </span>
                  </span>
                  <Link
                    href={w.href}
                    className={buttonClass(
                      i === 0 ? "primary" : "secondary",
                      "sm",
                    )}
                  >
                    Test my cases
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {showSearch && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-md min-w-0 flex-1 basis-56">
              <Input
                ref={box}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                placeholder="Search umbrellas and test cycles"
                aria-label="Search umbrellas and test cycles"
                className="pr-8"
              />
              {!query && (
                <kbd
                  className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-slate-300 px-1.5 text-[11px] text-slate-400"
                  aria-hidden
                >
                  /
                </kbd>
              )}
            </div>
            <div
              role="group"
              aria-label="Show"
              className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-surface text-sm"
            >
              {(["active", "archived", "all"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={scope === v}
                  onClick={() => setScope(v)}
                  className={cx(
                    "px-2.5 py-1.5",
                    scope === v
                      ? "bg-accent-600 text-white"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  {v === "active"
                    ? "Active"
                    : v === "archived"
                      ? "Archived"
                      : "All"}
                </button>
              ))}
            </div>
            <InfoTip text="Searches umbrella names, their test cycles, and older test cycles not in an umbrella. Archived ones show an Archived tag and open as usual. Admins can restore them from Settings." />
          </div>
        )}

        {found ? (
          <Section
            title={matchCount(found.length, closeFound.length)}
          >
            {found.length === 0 && closeFound.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nothing matches “{query.trim()}”
                {scope !== "all" ? ". Try All." : "."}
              </p>
            ) : (
              <div className="space-y-4">
                {(
                  [
                    ["umbrella", "Umbrellas"],
                    ["cycle", "Test cycles in umbrellas"],
                    ["loose", "Not in an umbrella"],
                  ] as const
                ).map(([kind, label]) => {
                  const list = found.filter((r) => r.kind === kind);
                  if (!list.length) return null;
                  return (
                    <div key={kind}>
                      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        {label}
                      </p>
                      <ul className="space-y-1.5">
                        {list.map((r) => (
                          <li
                            key={r.id}
                            className={cx(
                              "flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm",
                              r.archived && "opacity-75",
                            )}
                          >
                            <span className="min-w-14 font-mono text-xs font-semibold text-accent-700">
                              {r.key || "☂"}
                            </span>
                            <Link
                              href={r.href}
                              className="min-w-0 flex-1 font-medium text-slate-900 hover:underline"
                            >
                              {r.name}
                            </Link>
                            <span className="text-xs text-slate-500">
                              {r.where}
                            </span>
                            {r.archived && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                                Archived
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {closeFound.length > 0 && (
                  <div>
                    {found.length === 0 && <p className="mb-1 text-sm text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel className="px-0" />
                    <ul className="mt-1.5 space-y-1.5">
                      {closeFound.map((r) => (
                        <li key={r.id} className={cx("flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm", r.archived && "opacity-75")}>
                          <span className="min-w-14 font-mono text-xs font-semibold text-accent-700">{r.key || "☂"}</span>
                          <Link href={r.href} className="min-w-0 flex-1 font-medium text-slate-900 hover:underline">
                            {r.name}
                          </Link>
                          <span className="text-xs text-slate-500">{r.where}</span>
                          {r.archived && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Archived</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Section>
        ) : (
          <>
            {tickedUmbrellas.length > 0 && (
              <div
                className="sticky top-2 z-40 space-y-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white shadow-lg"
                role="region"
                aria-label="Ticked umbrellas"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <b className="mr-auto">{tickedUmbrellas.length} selected</b>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      hideUmbrellas(
                        tickedUmbrellas.map((u) => u.id),
                        true,
                      )
                    }
                  >
                    Hide for me
                  </Button>
                  {canArchiveTicked && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => setArchiving(true)}
                    >
                      Archive…
                    </Button>
                  )}
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-white/80 hover:text-white"
                    onClick={() => {
                      setTicked(new Set());
                      setArchiving(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {archiving && (
                  <div
                    role="alert"
                    className="rounded-md bg-red-50 px-3 py-2 text-red-900"
                  >
                    <p className="font-semibold">
                      Archive{" "}
                      {tickedUmbrellas.length === 1
                        ? tickedUmbrellas[0].name
                        : `${tickedUmbrellas
                            .slice(0, -1)
                            .map((u) => u.name)
                            .join(", ")} and ${tickedUmbrellas.at(-1)!.name}`}
                      {tickedCycles > 0 &&
                        `, and ${tickedUmbrellas.length === 1 ? "its" : "their"} ${tickedCycles} ${tickedCycles === 1 ? "test cycle" : "test cycles"}`}
                      ?
                    </p>
                    <p className="text-xs">
                      They disappear for everyone. Nothing is deleted, and you
                      can restore them from Archived at the bottom of the page.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={archiveTicked}
                      >
                        {busy ? "Archiving…" : "Yes, archive"}
                      </Button>
                      <Button size="sm" onClick={() => setArchiving(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {liveUmbrellas.length > 0 && (
              <div className="space-y-4">
                {liveUmbrellas.map((u, i) => (
                  <OrderedUmbrella
                    key={u.id}
                    u={u}
                    first={
                      i === 0 || liveUmbrellas[i - 1].starred !== u.starred
                    }
                    last={
                      i === liveUmbrellas.length - 1 ||
                      liveUmbrellas[i + 1].starred !== u.starred
                    }
                    alone={liveUmbrellas.length === 1}
                    groupIds={liveUmbrellas
                      .filter((x) => x.starred === u.starred)
                      .map((x) => x.id)}
                    onStar={() => starUmbrella(u)}
                    onMove={(where, id) => placeUmbrella(id ?? u.id, where)}
                    ticked={ticked.has(u.id)}
                    onTick={(on) => tick(u.id, on)}
                    onHide={() => hideUmbrellas([u.id], true)}
                  />
                ))}
              </div>
            )}
            {starred.length > 0 && (
              <Section title="Starred">
                <Grid>{cards(starred, sortable(starred))}</Grid>
              </Section>
            )}
            {recent.length > 0 && (
              <Section title="Recent">
                <Grid>{cards(recent)}</Grid>
              </Section>
            )}
            {rest.length > 0 && (
              <Section
                title={
                  looseHeading
                    ? "Not in an umbrella"
                    : starred.length || recent.length
                      ? crowded
                        ? "All other test cycles"
                        : "Other test cycles"
                      : crowded
                        ? "All test cycles"
                        : null
                }
                hint={
                  looseHeading
                    ? "Made before umbrellas, or moved out of one. Use ⋯ Move into an umbrella to share its cases, Jira and team."
                    : undefined
                }
                action={
                  ordered ? (
                    <button
                      type="button"
                      onClick={resetOrder}
                      className="text-xs text-accent-700 hover:underline"
                    >
                      Reset to A–Z
                    </button>
                  ) : null
                }
              >
                <Grid>{cards(rest, sortable(rest))}</Grid>
              </Section>
            )}
            {archivedCount > 0 && (
              <Fold
                label={`Archived (${archivedCount})`}
                tip="One fold for everything archived: umbrellas first, then test cycles not in an umbrella."
              >
                {archivedUmbrellas.length > 0 && (
                  <div className="space-y-4">
                    {archivedUmbrellas.map((u) => (
                      <UmbrellaCard key={u.id} u={u} />
                    ))}
                  </div>
                )}
                {archived.length > 0 && <Grid>{cards(archived)}</Grid>}
              </Fold>
            )}
            {hidden.length + hiddenUmbrellas.length > 0 && (
              <Fold
                label={`Hidden by you (${hidden.length + hiddenUmbrellas.length})`}
                tip="Only you stop seeing these here. Everyone else still does, and search and links still open them."
              >
                {hiddenUmbrellas.length > 0 && (
                  <div className="space-y-4">
                    {hiddenUmbrellas.map((u) => (
                      <UmbrellaCard
                        key={u.id}
                        u={u}
                        className="opacity-80"
                        tail={
                          <Button
                            onClick={() => hideUmbrellas([u.id], false)}
                          >
                            Show again
                          </Button>
                        }
                      />
                    ))}
                  </div>
                )}
                {hidden.length > 0 && <Grid>{cards(hidden)}</Grid>}
              </Fold>
            )}
          </>
        )}
      </div>
    </>
  );
}

// The umbrella being dragged.
let draggingUmbrella: string | null = null;

/**
 * An umbrella card with the viewer's tick box, star and ⋯ menu (move, hide). Drag it by
 * its top row (ver_94): a small name tag follows the mouse, a line shows where it lands,
 * and the page scrolls near the edges.
 */
function OrderedUmbrella({
  u,
  first,
  last,
  groupIds,
  alone,
  onStar,
  onMove,
  ticked,
  onTick,
  onHide,
}: {
  u: UmbrellaEntry;
  first: boolean;
  last: boolean;
  /** With only one umbrella there is nothing to reorder, so no dragging or Move items. */
  alone: boolean;
  groupIds: string[];
  onStar: () => void;
  /** Moves this umbrella, or the one dropped on it. */
  onMove: (where: Parameters<typeof moveUmbrella>[2], id?: string) => void;
  ticked: boolean;
  onTick: (on: boolean) => void;
  onHide: () => void;
}) {
  const [menu, setMenu] = useState(false);
  // Where a dragged umbrella would land: above or below this card.
  const [over, setOver] = useState<"above" | "below" | null>(null);
  const [dragging, setDragging] = useState(false);
  const accepts = () =>
    !!draggingUmbrella &&
    draggingUmbrella !== u.id &&
    groupIds.includes(draggingUmbrella);
  const lead = (
    <span className="flex items-center gap-0.5">
      <input
        type="checkbox"
        checked={ticked}
        onChange={(e) => onTick(e.target.checked)}
        aria-label={`Tick ${u.name}`}
        title="Tick to hide or archive"
        className="mr-1 size-4 cursor-pointer accent-accent-600"
      />
      <button
        type="button"
        onClick={onStar}
        aria-pressed={u.starred}
        aria-label={u.starred ? `Unstar ${u.name}` : `Star ${u.name}`}
        title={
          u.starred
            ? "Unstar"
            : "Star to keep it at the top. Only you see your stars and order."
        }
        className={cx(
          "rounded p-1 text-lg leading-none transition hover:bg-slate-100",
          u.starred ? "text-amber-500" : "text-slate-300 hover:text-amber-500",
        )}
      >
        {u.starred ? "★" : "☆"}
      </button>
    </span>
  );
  const tail = (
    <CardMenu
      name={u.name}
      open={menu}
      setOpen={setMenu}
      title={alone ? "Hide this umbrella" : "Move or hide this umbrella"}
      items={[
        !alone && { label: "Move up", run: () => onMove("up"), disabled: first },
        !alone && { label: "Move down", run: () => onMove("down"), disabled: last },
        !alone && { label: "Move to top", run: () => onMove("top"), disabled: first },
        !alone && {
          label: "Move to bottom",
          run: () => onMove("bottom"),
          disabled: last,
        },
        {
          label: "Hide for me",
          hint: "Only you stop seeing it here",
          run: onHide,
          divider: !alone,
        },
      ]}
    />
  );
  const grip: React.HTMLAttributes<HTMLDivElement> = alone
    ? {}
    : {
        draggable: true,
        title: "Drag to move",
        className: "cursor-grab active:cursor-grabbing",
        onDragStart: (e) => {
          draggingUmbrella = u.id;
          setDragging(true);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", u.name);
          // A small name tag follows the mouse, not the whole card.
          const tag = document.createElement("div");
          tag.textContent = `☂ ${u.name}`;
          tag.className = "fixed -top-24 left-0 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-[13px] font-semibold text-white";
          document.body.appendChild(tag);
          e.dataTransfer.setDragImage(tag, 12, 12);
          setTimeout(() => tag.remove(), 0);
          startEdgeScroll();
        },
        onDragEnd: () => {
          draggingUmbrella = null;
          setDragging(false);
          stopEdgeScroll();
        },
      };
  return (
    <div className={cx("relative", menu && "z-30")}>
      {over === "above" && (
        <div
          aria-hidden
          className="absolute -top-2.5 right-0 left-0 h-1 rounded-full bg-accent-600"
        />
      )}
      <UmbrellaCard
        u={u}
        lead={lead}
        tail={tail}
        grip={grip}
        className={cx(
          dragging && "opacity-40",
          ticked && "ring-2 ring-accent-500",
        )}
        onDragOver={(e) => {
          if (!accepts()) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          setOver(e.clientY < box.top + box.height / 2 ? "above" : "below");
        }}
        onDragLeave={(e) => {
          // Moving between the card's own parts isn't leaving it.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setOver(null);
        }}
        onDrop={(e) => {
          const where = over;
          setOver(null);
          if (!accepts()) return;
          e.preventDefault();
          const dragged = draggingUmbrella!;
          draggingUmbrella = null;
          stopEdgeScroll();
          // Above this card, or above the one after it; past the last, to the end.
          const rest = groupIds.filter((x) => x !== dragged);
          const after = rest[rest.indexOf(u.id) + 1];
          onMove(
            {
              before: where === "above" ? u.id : (after ?? null),
            },
            dragged,
          );
        }}
      />
      {over === "below" && (
        <div
          aria-hidden
          className="absolute right-0 -bottom-2.5 left-0 h-1 rounded-full bg-accent-600"
        />
      )}
    </div>
  );
}

// While an umbrella is dragged, the page scrolls when the mouse nears the top or bottom.
let edgeTimer: ReturnType<typeof setInterval> | null = null;
let edgeY = -1;
const trackY = (e: DragEvent) => (edgeY = e.clientY);
function startEdgeScroll() {
  stopEdgeScroll();
  document.addEventListener("dragover", trackY);
  edgeTimer = setInterval(() => {
    if (edgeY < 0) return;
    if (edgeY < 80) window.scrollBy(0, -18);
    else if (edgeY > window.innerHeight - 80) window.scrollBy(0, 18);
  }, 30);
}
function stopEdgeScroll() {
  if (edgeTimer) clearInterval(edgeTimer);
  edgeTimer = null;
  edgeY = -1;
  document.removeEventListener("dragover", trackY);
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string | null;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title ?? "Umbrellas"}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {title}
          </h2>
          {action}
        </div>
      )}
      {hint && <p className="-mt-1 mb-2 text-xs text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}

function Fold({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-700">
        <span
          className="inline-block transition group-open:rotate-90"
          aria-hidden
        >
          ▸
        </span>{" "}
        {label}
        {tip && <InfoTip text={tip} className="ml-1.5" />}
      </summary>
      <div className="mt-2 space-y-4">{children}</div>
    </details>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

type CardActions = {
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

function OrganizeCard({
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
              "relative z-10 -m-1 rounded p-1 text-base leading-none transition hover:bg-slate-100",
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
function GroupCard({
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
                "relative z-10 -m-1 rounded p-1 text-base leading-none transition hover:bg-slate-100",
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

function CardMenu({
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
