import { ProjectNav } from "@/components/project-nav";
import { UmbrellaNav } from "@/components/umbrella-nav";
import { NOT_BASH_CASE, NOT_BASH_RUN } from "@/lib/bash-cases";
import { db } from "@/lib/db";
import { glossaryMenu } from "@/lib/glossary-data";
import { liveBashOf, loadUmbrella, navOf, openBugCount, platformColor, type Umbrella } from "@/lib/umbrella";

type Viewer = { id: string; isAdmin: boolean; gameEnabled: boolean; questMap: boolean };
type MenuProject = { id: string; key: string; name: string; groupId: string | null; platform: string };

/**
 * The left menu for a test cycle: inside an umbrella it's the umbrella's own menu with this
 * test cycle lit under Test runs, so the menu looks the same on every page of the umbrella.
 * A test cycle on its own gets the same shape of menu, about itself.
 */
export async function ProjectMenu({ project, user, umbrella }: { project: MenuProject; user: Viewer; umbrella?: Umbrella | null }) {
  const quests = user.gameEnabled && user.questMap;
  // Glossary: one list for everyone, in every menu, with a dot when your question got answered.
  // Asked together: the glossary, the umbrella, and the test cycle's own cases.
  const ownCasesP = project.groupId ? db.testCase.count({ where: { projectId: project.id, archived: false, ...NOT_BASH_CASE } }).catch(() => 0) : Promise.resolve(0);
  const [glossary, group] = await Promise.all([
    glossaryMenu(user.id),
    umbrella ? null : project.groupId ? db.projectGroup.findUnique({ where: { id: project.groupId }, select: { id: true, name: true, hubProjectId: true } }) : null,
  ]);
  const u = umbrella ?? (group?.hubProjectId ? await loadUmbrella(group.id, user) : null);
  if (u) {
    const isHub = u.hub.id === project.id;
    const nav = navOf(u);
    if (isHub) return <UmbrellaNav u={nav} glossary={glossary} />;
    const ownCases = await ownCasesP;
    return (
      <UmbrellaNav
        glossary={glossary}
        u={{
          ...nav,
          cycle: {
            key: project.key,
            name: project.name.startsWith(`${u.group.name} `) ? project.name.slice(u.group.name.length + 1) : project.name,
            color: platformColor(u.platforms, project.platform),
            older: !nav.current.some((c) => c.key === project.key),
            ownCases,
            quests,
          },
        }}
      />
    );
  }
  // Not on the umbrella's team (a test cycle that keeps members separate): its own menu, pointing at the umbrella's library.
  const where = { projectId: project.id, archived: false };
  const [hub, cases, charters, suites, shared, personas, activeRuns, openBugs, live] = await Promise.all([
    group?.hubProjectId ? db.project.findUnique({ where: { id: group.hubProjectId }, select: { key: true } }) : null,
    db.testCase.count({ where: { ...where, type: { not: "EXPLORATORY" } } }),
    db.testCase.count({ where: { ...where, type: "EXPLORATORY", ...NOT_BASH_CASE } }),
    db.testSuite.count({ where }),
    db.sharedStep.count({ where }),
    db.persona.count({ where }),
    db.testRun.count({ where: { projectId: project.id, state: "ACTIVE", ...NOT_BASH_RUN } }),
    openBugCount([project.id]),
    liveBashOf(project.id),
  ]);
  return (
    <ProjectNav
      projectKey={project.key}
      projectName={project.name}
      quests={quests}
      glossary={glossary}
      counts={{ cases, charters, suites, shared, personas, activeRuns, openBugs }}
      live={!!live}
      library={hub ? { hubKey: hub.key, name: group!.name, ownCases: cases } : undefined}
    />
  );
}
