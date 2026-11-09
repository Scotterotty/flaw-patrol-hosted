"use client";

import { CloseMatchesLabel } from "./close-matches";
import { matchCount } from "@/lib/fuzzy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { arrange, arrangeUmbrellas, CROWDED, findRowsForgiving, moveUmbrella, UMBRELLA_SORT_COOKIE, UMBRELLA_SORTS, type FindRow, type FindScope, type ProjectItem, type UmbrellaItem, type UmbrellaSort } from "@/lib/project-list";
import { setGroupsHidden, setGroupStarred } from "@/server/groups";
import { setUmbrellaArchived } from "@/server/umbrella";
import { setArchived, setHidden, setProjectOrder, setStarred } from "@/server/projects";
import { UmbrellaCard, type UmbrellaCardData } from "./umbrella-ui";
import { YourWork, type YourBashRow, type YourWorkRow } from "./your-work";
import { Button, cx, ErrorText, InfoTip, Input, PageHeader, Select } from "./ui";
import { type ProjectCardData, type GroupCardData, type Item, type CardActions, type Sortable, GroupCard, OrganizeCard, CardMenu } from "./project-cards";
export { type ProjectCardData, type GroupCardData } from "./project-cards";

/** An umbrella card on the page, with the viewer's star and place, and its test cycles for search. */
export type UmbrellaEntry = UmbrellaCardData &
  UmbrellaItem & {
    cycles: { id: string; key: string; name: string; archived: boolean }[];
    /** Hidden from the viewer's page. */
    hidden: boolean;
    /** The viewer may archive it (admins). */
    canArchive: boolean;
    /** The viewer may add a test cycle to it, so Move into an umbrella… can offer it. */
    canAddCycle: boolean;
  };

type Props = {
  subtitle: string;
  /** Runs with cases assigned to the viewer that still need testing. */
  yourWork?: YourWorkRow[];
  yourBashes?: YourBashRow[];
  /** The viewer opened every row last time. */
  yourWorkOpen?: boolean;
  /** New umbrella, for everyone but Viewers. */
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

/** The Umbrellas page: search, Starred, Recent, the rest, and Archived and Hidden tucked away. */
export function ProjectsBrowser({
  subtitle,
  yourWork = [],
  yourBashes = [],
  yourWorkOpen = false,
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
  // Umbrellas ticked for Hide for me or Archive….
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

        <YourWork rows={yourWork} bashes={yourBashes} open={yourWorkOpen} />

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
 * its top row: a small name tag follows the mouse, a line shows where it lands,
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
      {/* Cards inside use h3, so a section without a shown title still names itself for screen readers (ver_209, Lighthouse). */}
      {!title && <h2 className="sr-only">Umbrellas</h2>}
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
