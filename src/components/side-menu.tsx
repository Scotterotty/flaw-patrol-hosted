"use client";

import { PaneResizer } from "@/components/pane-resizer";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { applyOrder, EMPTY_NAV_ORDER, isDefaultOrder, moveItem, type NavOrder } from "@/lib/nav-order";
import { saveMyNavOrder } from "@/server/account";
import { useNavOrder } from "./nav-order";
import { Button, cx } from "./ui";
import { VersionLine } from "./version-line";
import { toggleHowTo } from "./how-to-guide";

/**
 * One menu link. `sub` indents it under the link above; `inner` indents it one more step (under the test cycle you're in).
 * `heading` makes it a small label (not a link) over the `sub` links that follow, like "Test cycles · 4.2".
 * `id` lets people move it with Arrange menu order; test cycle rows use "cycle:<platform>".
 */
export type MenuItem = {
  href: string;
  label: string;
  id?: string;
  count?: number | string;
  dot?: string;
  /** Shown in red after the label, like "Live" on Bug bashes while one is running. */
  badge?: string;
  /** A small dot: something new for you there, like an answer to your Glossary question. */
  note?: boolean;
  sub?: boolean;
  inner?: boolean;
  exact?: boolean;
  tip?: string;
  onBar?: boolean;
  heading?: boolean;
  /** The umbrella tool it belongs to; the item leaves the menu while that tool is off. */
  tool?: string;
  /** A small + at the end of the row that's always showing, like Write a bug next to Bugs. */
  plus?: { href: string; label: string };
  /** A button instead of a link: "how-to" opens the How-to guide panel. */
  action?: "how-to";
  /** A small NEW tag after the label, for a little while after something ships. */
  isNew?: boolean;
  /** A small gray tag after the label, like "Needs Jira" while what the page shows can't work yet. */
  tag?: string;
  /** The How-to guide finds the link by data-howto="menu-<howto or id>". */
  howto?: string;
};
export type MenuGroup = { label: string; items: MenuItem[] };

/** A link and the rows under it (a test cycle row and its own inner links). */
type Child = { item: MenuItem; inner: MenuItem[] };
type Unit = { item: MenuItem; children: Child[] };
type Dragging = { group: string; id: string; kind: "unit" | "child"; parent?: string };

function unitsOf(items: MenuItem[]): Unit[] {
  const units: Unit[] = [];
  for (const i of items) {
    const last = units[units.length - 1];
    if (i.inner && last?.children.length) last.children[last.children.length - 1].inner.push(i);
    else if ((i.sub || i.heading || i.inner) && last) last.children.push({ item: i, inner: [] });
    else units.push({ item: i, children: [] });
  }
  return units;
}

const cycleId = (c: Child) => (c.item.id?.startsWith("cycle:") ? c.item.id : undefined);

/** The groups in this person's order: links within their section, test cycle rows within Test runs. */
function ordered(groups: MenuGroup[], order: NavOrder) {
  return groups.map((g) => ({
    label: g.label,
    units: (g.label ? applyOrder(unitsOf(g.items), (u) => u.item.id, order.sections[g.label] ?? []) : unitsOf(g.items)).map((u) => ({
      ...u,
      children: applyOrder(u.children, cycleId, order.cycles),
    })),
  }));
}

const flat = (units: Unit[]) => units.flatMap((u) => [u.item, ...u.children.flatMap((c) => [c.item, ...c.inner])]);

/**
 * The left menu every page uses: a name card on top, grouped links, and an optional link
 * pinned to the bottom. On phones it becomes a bottom bar that scrolls sideways.
 * Arrange menu order at the bottom lets each person drag links into their own order.
 */
export function SideMenu({ label, head, groups, footer, active }: { label: string; head: ReactNode; groups: MenuGroup[]; footer?: MenuItem; active: (i: MenuItem) => boolean }) {
  const path = usePathname();
  const router = useRouter();
  const bar = useRef<HTMLElement>(null);
  const saved = useNavOrder();
  const savedKey = JSON.stringify(saved);
  // What's shown: the saved order, or the one being arranged right now.
  const [mine, setMine] = useState<NavOrder>(saved);
  useEffect(() => setMine(JSON.parse(savedKey)), [savedKey]);
  const [arranging, setArranging] = useState(false);
  const [drag, setDrag] = useState<Dragging | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const before = useRef<NavOrder | null>(null);
  const dropped = useRef(false);
  const focusId = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  // On phones the bottom bar scrolls sideways; bring the page you're on into view.
  useEffect(() => {
    const on = bar.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (bar.current && on) bar.current.scrollLeft = on.offsetLeft - (bar.current.clientWidth - on.offsetWidth) / 2;
  }, [path]);
  // Keyboard moves keep the grip you're on focused.
  useEffect(() => {
    if (!focusId.current) return;
    navRef.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(focusId.current)}"]`)?.focus();
    focusId.current = null;
  });
  const shown = ordered(groups, mine);

  const save = (o: NavOrder) => {
    setMine(o);
    void saveMyNavOrder(o).then((r) => {
      if (!r.ok) setNote(r.error);
      else router.refresh();
    });
  };
  /** The order with one unit (or test cycle row) moved, by its place in what's shown. */
  const moved = (o: NavOrder, group: string, d: Dragging, to: number): NavOrder => {
    const g = ordered(groups, o).find((x) => x.label === group);
    if (!g) return o;
    if (d.kind === "unit") {
      const ids = g.units.map((u) => u.item.id).filter((x): x is string => !!x);
      const from = ids.indexOf(d.id);
      return { ...o, sections: { ...o.sections, [group]: moveItem(ids, from, Math.max(0, Math.min(ids.length - 1, to))) } };
    }
    const parent = g.units.find((u) => u.item.id === d.parent);
    const ids = (parent?.children ?? []).map(cycleId).filter((x): x is string => !!x);
    const from = ids.indexOf(d.id);
    // Remember platforms from before too, so a platform that's not in this release keeps its place.
    const rest = o.cycles.filter((x) => !ids.includes(x));
    return { ...o, cycles: [...moveItem(ids, from, Math.max(0, Math.min(ids.length - 1, to))), ...rest] };
  };
  const indexIn = (group: string, d: Dragging, id: string) => {
    const g = shown.find((x) => x.label === group);
    if (!g) return -1;
    if (d.kind === "unit") return g.units.map((u) => u.item.id).filter(Boolean).indexOf(id);
    const parent = g.units.find((u) => u.item.id === d.parent);
    return (parent?.children ?? []).map(cycleId).filter(Boolean).indexOf(id);
  };
  const keyMove = (group: string, d: Dragging, by: number) => {
    const at = indexIn(group, d, d.id);
    if (at < 0) return;
    focusId.current = d.id;
    save(moved(mine, group, d, at + by));
  };

  const guideName = (i: MenuItem) => (i.howto ?? i.id ? `menu-${i.howto ?? i.id}` : undefined);
  const row = (i: MenuItem) =>
    i.action ? (
      actionButton(i)
    ) : i.plus ? (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{link(i)}</div>
        <Link
          href={i.plus.href}
          aria-label={i.plus.label}
          title={i.plus.label}
          data-testid="menu-plus"
          data-howto={guideName(i) && `${guideName(i)}-plus`}
          className="grid size-7 flex-none place-items-center rounded-md text-base leading-none font-semibold text-accent-700 ring-1 ring-accent-200 ring-inset hover:bg-accent-50 focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          +
        </Link>
      </div>
    ) : (
      link(i)
    );
  const link = (i: MenuItem) => (
    <Link
      href={i.href}
      aria-current={active(i) ? "page" : undefined}
      title={i.tip}
      data-howto={guideName(i)}
      className={cx(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
        i.inner && "py-1 text-[13px]",
        active(i)
          ? "bg-accent-100 font-semibold text-accent-700 ring-1 ring-accent-500 ring-inset"
          : i.sub || i.inner
            ? "text-slate-600 hover:bg-slate-100"
            : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {i.dot && <span aria-hidden className="size-1.5 flex-none rounded-full" style={{ background: i.dot }} />}
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {i.badge && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{i.badge}</span>}
      {i.tag && <span className="flex-none rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 ring-inset" data-testid="menu-tag">{i.tag}</span>}
      {i.note && <span className="size-2 flex-none rounded-full bg-accent-600" title="New answer to your question" aria-label="New answer to your question" data-testid="menu-note" />}
      {i.count !== undefined && <span className="text-xs font-normal text-slate-400 tabular-nums">{i.count}</span>}
    </Link>
  );
  /** A menu row that does something on this page instead of opening one, like How-to guide. */
  const actionButton = (i: MenuItem, small = false) => (
    <button
      type="button"
      title={i.tip}
      onClick={() => i.action === "how-to" && toggleHowTo()}
      data-testid={i.action === "how-to" ? "menu-how-to" : undefined}
      className={cx(
        small ? "shrink-0 rounded-md px-2.5 py-1 text-xs text-slate-600" : "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100",
        "focus-visible:outline-2 focus-visible:outline-accent-500",
      )}
    >
      <span className={small ? undefined : "min-w-0 flex-1 truncate"}>{i.label}</span>
      {i.isNew && <span className={cx("rounded-full bg-orange-600 px-1.5 text-[10px] font-bold text-white", small && "ml-1")}>NEW</span>}
    </button>
  );
  /** A row while arranging: a grip to drag (or ↑/↓), and the name, which doesn't open the page. */
  const grip = (i: MenuItem, group: string, d: Dragging | null) => (
    <div
      draggable={!!d}
      onDragStart={(e) => {
        if (!d) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", d.id);
        before.current = mine;
        dropped.current = false;
        setDrag(d);
      }}
      onDragOver={(e) => {
        if (!drag || drag.group !== group) return;
        // The dragged link slides under the pointer, so hovering it (or a link it can't swap with) is still a fine place to drop.
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setWrong(null);
        if (!d || drag.kind !== d.kind || drag.parent !== d.parent || drag.id === d.id) return;
        const to = indexIn(group, drag, d.id);
        if (to >= 0) setMine(moved(mine, group, drag, to));
      }}
      onDrop={(e) => {
        if (!drag || drag.group !== group) return;
        e.preventDefault();
        dropped.current = true;
      }}
      onDragEnd={() => {
        if (dropped.current && !wrong) save(mine);
        else if (before.current) setMine(before.current);
        before.current = null;
        setDrag(null);
        setWrong(null);
      }}
      className={cx(
        "flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm select-none",
        i.inner && "py-1 text-[13px]",
        d ? "cursor-grab bg-slate-50 text-slate-800 ring-1 ring-slate-200 ring-inset active:cursor-grabbing" : "text-slate-400",
        drag && d && drag.id === d.id && "opacity-60 ring-accent-500",
      )}
    >
      {d ? (
        <button
          type="button"
          data-grip={d.id}
          data-howto="arrange-grip"
          aria-label={`Move ${i.label}. Use the up and down arrow keys.`}
          className="grid h-5 w-4 flex-none cursor-grab place-items-center rounded text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-accent-500"
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            keyMove(group, d, e.key === "ArrowUp" ? -1 : 1);
          }}
        >
          ⠿
        </button>
      ) : (
        <span aria-hidden className="w-4 flex-none" />
      )}
      {i.dot && <span aria-hidden className="size-1.5 flex-none rounded-full" style={{ background: i.dot }} />}
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
    </div>
  );
  const onBar = (i: MenuItem) => !i.heading && (i.onBar ?? !(i.sub || i.inner));
  const changed = !isDefaultOrder(mine);
  return (
    <>
      {/* The background and border run the full height of the page; the links inside stay in view as you scroll. */}
      <div className="fp-bar relative hidden w-52 shrink-0 border-r border-slate-200 bg-surface md:block">
        <nav ref={navRef} aria-label={label} className="sticky top-12 flex h-[calc(100vh-3rem)] flex-col overflow-y-auto px-2 py-4">
          {head}
          {arranging && (
            <p className="mb-1 rounded-md bg-accent-50 px-2.5 py-1.5 text-xs text-accent-800 ring-1 ring-accent-200 ring-inset">
              Drag links by ⠿ to put them in your order. They stay in their own section. Only you see your order.
            </p>
          )}
          {shown.map((grp) => {
            const isWrong = arranging && wrong === grp.label;
            return (
              <div
                key={grp.label || "top"}
                data-section={grp.label}
                className={cx(isWrong && "rounded-md bg-red-50 ring-2 ring-red-400")}
                onDragOver={(e) => {
                  if (!drag) return;
                  // The gaps between links in its own section take the drop too.
                  if (drag.group === grp.label) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (wrong) setWrong(null);
                  } else {
                    e.preventDefault();
                    if (wrong !== grp.label) {
                      setWrong(grp.label);
                      if (before.current) setMine(before.current);
                    }
                  }
                }}
                onDrop={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  dropped.current = drag.group === grp.label;
                }}
              >
                {grp.label && (
                  <p className="flex cursor-default items-center gap-[7px] px-2.5 pt-[18px] pb-1.5 text-[12.5px] font-semibold text-slate-900 select-none after:ml-[3px] after:h-px after:flex-1 after:bg-slate-200 after:content-['']">
                    <SectionIcon name={grp.label} />
                    <span>{grp.label}</span>
                  </p>
                )}
                {isWrong && drag && (
                  <p role="status" className="px-2.5 pb-1 text-xs font-semibold text-red-700">
                    Stays in {drag.group}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {grp.units.flatMap((u) => {
                    const unitDrag: Dragging | null = arranging && grp.label && u.item.id ? { group: grp.label, id: u.item.id, kind: "unit" } : null;
                    const lines: { i: MenuItem; d: Dragging | null }[] = [
                      { i: u.item, d: unitDrag },
                      ...u.children.flatMap((c) => {
                        const id = cycleId(c);
                        const childDrag: Dragging | null = arranging && id && u.item.id && u.children.filter(cycleId).length > 1 ? { group: grp.label, id, kind: "child", parent: u.item.id } : null;
                        return [{ i: c.item, d: childDrag }, ...c.inner.map((i) => ({ i, d: null }))];
                      }),
                    ];
                    return lines.map(({ i, d }, n) => {
                      const prev = lines[n - 1]?.i;
                      return (
                        <li key={i.href + i.label} className={cx((i.sub || i.inner) && "ml-3 border-l border-slate-200 pl-2", i.sub && !prev?.sub && !prev?.inner && "mt-0.5")}>
                          {i.heading ? (
                            <p className="cursor-default px-2.5 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase select-none">{i.label}</p>
                          ) : arranging && grp.label ? (
                            i.inner ? <div className="ml-3 border-l border-dashed border-slate-300 pl-1.5">{grip(i, grp.label, d)}</div> : grip(i, grp.label, d)
                          ) : i.inner ? (
                            <div className="ml-3 border-l border-dashed border-slate-300 pl-1.5">{row(i)}</div>
                          ) : (
                            row(i)
                          )}
                        </li>
                      );
                    });
                  })}
                </ul>
              </div>
            );
          })}
          <div className="mt-auto pt-3">
            {footer && <div className="border-t border-slate-200 pt-2">{row(footer)}</div>}
            {arranging ? (
              <div className="mt-2 grid gap-1.5 border-t border-slate-200 pt-2">
                <Button size="sm" variant="primary" onClick={() => setArranging(false)} data-howto="arrange-done">
                  Done
                </Button>
                <Button size="sm" variant="ghost" disabled={!changed} onClick={() => save(EMPTY_NAV_ORDER)} data-howto="arrange-reset">
                  Reset to default order
                </Button>
                {note && <p className="text-xs text-red-700">{note}</p>}
              </div>
            ) : (
              <button
                type="button"
                className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                title="Drag the links in this menu into your own order. Only you see it."
                data-howto="arrange-menu"
                onClick={() => {
                  setNote("");
                  setArranging(true);
                }}
              >
                <span aria-hidden>⠿</span> Arrange menu order
              </button>
            )}
            <VersionLine className="mt-0.5" />
          </div>
        </nav>
        <PaneResizer id="left-menu" label="the left menu" min={160} max={320} target="parent" />
      </div>
      <nav
        ref={bar}
        aria-label={label}
        className="fp-bar fixed inset-x-0 bottom-0 z-20 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-t border-slate-200 bg-surface px-2 py-1.5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
      >
        {[...shown.map((g) => ({ label: g.label, items: flat(g.units) })), ...(footer ? [{ label: "Footer", items: [footer] }] : [])].map((grp, n) => (
          <Fragment key={grp.label || "top"}>
            {n > 0 && <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />}
            {grp.items.filter(onBar).map((i) => i.action ? <Fragment key={i.href + i.label}>{actionButton(i, true)}</Fragment> : (
              <Link
                key={i.href + i.label}
                href={i.href}
                aria-current={active(i) ? "page" : undefined}
                title={i.tip}
                data-howto={guideName(i)}
                className={cx(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs",
                  active(i) ? "bg-accent-100 font-semibold text-accent-700 ring-1 ring-accent-500 ring-inset" : "text-slate-600",
                )}
              >
                {i.label}
                {i.badge && <span className="ml-1 rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">{i.badge}</span>}
              </Link>
            ))}
          </Fragment>
        ))}
      </nav>
    </>
  );
}

/** The name card at the top of the menu. */
export function MenuHead({ href, name, kind, icon }: { href: string; name: string; kind: string; icon: ReactNode }) {
  return (
    <Link href={href} className="mb-2 flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-slate-100">
      <span className="grid size-9 flex-none place-items-center rounded-lg bg-accent-50 text-accent-600">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-slate-900">{name}</span>
        <span className="block text-xs text-slate-500">{kind}</span>
      </span>
    </Link>
  );
}

/** Small accent icons for the menu's section headings (book, play circle, bar chart). */
export function SectionIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    Library: (
      <>
        <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5z" />
        <path d="M8 7h8" />
      </>
    ),
    Testing: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5l5 3.5-5 3.5z" />
      </>
    ),
    Results: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    Settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[15px] flex-none text-accent-500"
    >
      {paths[name]}
    </svg>
  );
}
