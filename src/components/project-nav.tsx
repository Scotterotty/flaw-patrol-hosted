"use client";

import { usePathname } from "next/navigation";
import { MenuHead, SideMenu, type MenuGroup, type MenuItem } from "./side-menu";

export { SectionIcon } from "./side-menu";

/** For a test cycle that's in an umbrella but whose viewer isn't on the umbrella's team: its Library points at the umbrella's Case library. */
export type NavLibrary = { hubKey: string; name: string; ownCases: number };
export type NavCounts = { cases: number; charters: number; suites: number; shared: number; personas: number; activeRuns: number; openBugs: number };

/**
 * A test cycle's left menu, shaped like the umbrella menu: name card on top, Library, Testing,
 * Results, then Settings. Test cycles in an umbrella show the umbrella's menu instead (see ProjectMenu).
 */
export function ProjectNav({ projectKey, projectName, quests = false, counts, library, live, glossary }: { projectKey: string; projectName: string; quests?: boolean; counts: NavCounts; library?: NavLibrary; live?: boolean; glossary?: { count: number; unseen: boolean } }) {
  const path = usePathname();
  const base = `/p/${projectKey}`;
  // Grouped in the order the team works: write tests, run them, then see what broke.
  const glossaryItem: MenuItem = { href: `${base}/glossary`, id: "glossary", label: "Glossary", count: glossary?.count || undefined, note: glossary?.unseen, tip: "The team's words and what they mean" };
  const groups: MenuGroup[] = [
    { label: "", items: [{ href: base, label: "Overview", exact: true }] },
    {
      label: "Library",
      items: library
        ? [
            { href: `/p/${library.hubKey}/cases`, id: "cases", label: `${library.name} case library ↗` },
            // Cases from before the test cycle joined the umbrella stay reachable until they're moved up.
            ...(library.ownCases ? [{ href: `${base}/cases`, id: "own-cases", label: "Cases left here", count: library.ownCases }] : []),
            { href: `${base}/suites`, id: "suites", label: "Test suites", count: counts.suites },
            glossaryItem,
          ]
        : [
            { href: `${base}/cases`, id: "cases", label: "Test cases", count: counts.cases },
            { href: `${base}/charters`, id: "charters", label: "Charters", count: counts.charters, tip: "Missions to explore without steps, and the test personas you explore as" },
            { href: `${base}/stories`, id: "stories", label: "Requirements" },
            { href: `${base}/suites`, id: "suites", label: "Test suites", count: counts.suites },
            { href: `${base}/shared-steps`, id: "shared", label: "Shared steps", count: counts.shared },
            glossaryItem,
          ],
    },
    {
      label: "Testing",
      items: [
        { href: `${base}/runs`, id: "runs", label: "Test runs", count: counts.activeRuns ? `${counts.activeRuns} active` : undefined },
        ...(quests ? [{ href: `${base}/quests`, id: "quests", label: "Quest map" }] : []),
        // A test cycle that keeps members separate runs its own bashes; its risk board is the umbrella's.
        ...(library ? [] : [{ href: `${base}/bashes`, id: "bashes", label: "Bug bashes", badge: live ? "Live" : undefined, tip: "Everyone explores for a set time and logs bugs" }]),
        ...(library ? [] : [{ href: `${base}/risk`, id: "risk", label: "Risk board", tip: "Which requirements in a release are most likely to break, and how much it would hurt" }]),
      ],
    },
    {
      label: "Results",
      items: [
        { href: `${base}/bugs`, id: "bugs", label: "Bugs", count: counts.openBugs || undefined },
        { href: `${base}/reports`, id: "reports", label: "Reports" },
      ],
    },
    { label: "Settings", items: [{ href: `${base}/settings`, id: "cycle-settings", label: `${projectName} settings` }] },
  ];
  // Import lives under Test cases (its button is there), so that link stays lit while importing.
  const active = (i: MenuItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`)) || (i.href === `${base}/cases` && path.startsWith(`${base}/import`));
  return <SideMenu label={projectName} head={<MenuHead href={base} name={projectName} kind="Test cycle" icon={<CycleIcon />} />} groups={groups} active={active} />;
}

function CycleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
      <path d="M5 21V4h11l-2 4 2 4H5" />
    </svg>
  );
}
