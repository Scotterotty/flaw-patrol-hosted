"use client";

import { usePathname } from "next/navigation";
import type { UmbrellaNav as NavData } from "@/lib/umbrella";
import { MenuHead, SideMenu, type MenuGroup, type MenuItem } from "./side-menu";

/**
 * The umbrella's left menu: its Case library, runs across its test cycles (with the current RC ones), bugs and settings.
 * Every page in the umbrella shows it, test cycle pages too: then `u.cycle` is lit under Test cycles,
 * with its Quest map under it and its settings under Settings.
 */
export function UmbrellaNav({ u, glossary }: { u: NavData; glossary?: { count: number; unseen: boolean } }) {
  const path = usePathname();
  const g = `/g/${u.id}`;
  const hub = `/p/${u.hubKey}`;
  const c = u.cycle;
  const cb = c ? `/p/${c.key}` : "";
  // The current test cycles get their own label so they don't read as runs (ver_87). When they all test
  // the same RC on different platforms, the label names the RC once and each row just names its platform.
  const rcs = new Set(u.current.map((p) => p.rc));
  const sameRc = u.current.length > 1 && rcs.size === 1 && !rcs.has("") && u.current.every((p) => p.platform);
  const shortName = (p: { key: string; name: string }) => (sameRc ? (u.current.find((x) => x.key === p.key)?.platform ?? p.name) : p.name);
  // Arrange menu order remembers test cycle rows by platform, so the next release lists them the same way.
  const cycleKey = (key: string) => {
    const p = u.current.find((x) => x.key === key);
    return `cycle:${(p?.platform || p?.name || key).toLowerCase()}`;
  };
  const cycleHeading: MenuItem[] = u.current.length ? [{ href: `${g}#test-cycles`, label: sameRc ? `Test cycles · ${[...rcs][0]}` : "Test cycles", sub: true, heading: true }] : [];
  const cycleLinks: MenuItem[] = c
    ? [
        { href: cb, id: c.older ? undefined : cycleKey(c.key), label: c.older ? c.name : shortName(c), dot: c.color, sub: true, onBar: true },
        ...(c.quests ? [{ href: `${cb}/quests`, label: "Quest map", inner: true, onBar: true }] : []),
        // Cases from before the test cycle joined the umbrella stay reachable until they're moved up.
        ...(c.ownCases ? [{ href: `${cb}/cases`, label: "Cases left here", count: c.ownCases, inner: true }] : []),
      ]
    : [];
  const groups: MenuGroup[] = [
    { label: "", items: [{ href: g, label: "Overview", exact: true }] },
    {
      label: "Library",
      items: [
        { href: `${hub}/cases`, id: "cases", label: "Case library", count: u.counts.cases, tip: `Whole test cases every ${u.name} test cycle runs` },
        { href: `${hub}/charters`, id: "charters", label: "Charters", count: u.counts.charters, tip: "Missions to explore without steps, and the test personas you explore as" },
        { href: `${hub}/stories`, id: "stories", label: "Requirements", tip: "Jira stories, Epics and other requirements, and which cases test them" },
        { href: `${hub}/suites`, id: "suites", label: "Test suites", count: u.counts.suites },
        { href: `${hub}/shared-steps`, id: "shared", label: "Shared steps", count: u.counts.shared, tip: "Extra steps you add to new or existing cases" },
        { href: `${hub}/glossary`, id: "glossary", label: "Glossary", count: glossary?.count || undefined, note: glossary?.unseen, tip: "The team's words and what they mean" },
      ],
    },
    {
      label: "Testing",
      items: [
        { href: `${g}/runs`, id: "runs", label: "Test runs", count: u.counts.activeRuns ? `${u.counts.activeRuns} active` : undefined },
        ...cycleHeading,
        ...u.current.flatMap((p) => (c && p.key === c.key ? cycleLinks : [{ href: `/p/${p.key}`, id: cycleKey(p.key), label: shortName(p), dot: p.color, sub: true, tip: p.name }])),
        ...(u.older ? [{ href: `${g}/projects`, label: "Older test cycles", count: u.older, sub: true }] : []),
        // An older test cycle shows under Older test cycles while you're in it.
        ...(c?.older ? cycleLinks : []),
        { href: `${hub}/bashes`, id: "bashes", label: "Bug bashes", badge: u.live ? "Live" : undefined, tip: "Everyone explores for a set time and logs bugs" },
        { href: `${hub}/risk`, id: "risk", label: "Risk board", tip: "Which requirements in a release are most likely to break, and how much it would hurt" },
      ],
    },
    {
      label: "Results",
      items: [
        { href: `${g}/bugs`, id: "bugs", label: "Bugs", count: u.counts.openBugs || undefined },
        { href: `${g}/reports`, id: "reports", label: "Reports" },
        // Once a GitHub repo is connected (ver_85).
        ...(u.counts.repos ? [{ href: `${g}/repos`, id: "repos", label: "Repositories", count: u.counts.repos, tip: "Test health of each connected GitHub repo" }] : []),
      ],
    },
    {
      label: "Settings",
      // Every current test cycle's settings sit next to the umbrella's on every page (ver_95; before, only the
      // one you were in), plus an older test cycle's while you're in it.
      items: [
        { href: `${g}/settings`, id: "settings", label: `${u.name} settings` },
        ...[...u.current, ...(c?.older ? [c] : [])].map((p) => ({ href: `/p/${p.key}/settings`, id: c?.older && p.key === c.key ? undefined : `${cycleKey(p.key)}:settings`, label: `${p.name} settings` })),
      ],
    },
  ];
  const under = (href: string) => path === href || path.startsWith(`${href}/`);
  // Inside a test cycle its own row stays lit on all of its pages, except the ones with a link of their own.
  const ownLinks = c ? [`${cb}/quests`, `${cb}/settings`, ...(c.ownCases ? [`${cb}/cases`, `${cb}/import`] : [])] : [];
  const active = (i: MenuItem) => {
    if (c && i.href === cb) return under(cb) && !ownLinks.some(under);
    if (c && i.href === `${cb}/cases`) return under(i.href) || under(`${cb}/import`);
    return (i.exact ? path === i.href : under(i.href)) || (i.href === `${hub}/cases` && path.startsWith(`${hub}/import`)) || (i.href === `${g}/reports` && path.startsWith(`${g}/rc`));
  };

  return (
    <SideMenu
      label={`${u.name} umbrella`}
      head={<MenuHead href={g} name={u.name} kind={u.archived ? "Umbrella · Archived" : "Umbrella"} icon={<UmbrellaIcon className="size-5" />} />}
      groups={groups}
      active={active}
    />
  );
}

export function UmbrellaIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 18 0z" />
      <path d="M12 12v6a2 2 0 0 0 4 0" />
      <path d="M12 3v0" />
    </svg>
  );
}
