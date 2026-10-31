import { AutoFilterForm } from "@/components/auto-filter-form";
import { runFieldsFor } from "@/lib/run-fields-server";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { FlagIcon } from "@/components/case-flag";
import { CaseTable } from "@/components/case-table";
import { FolderTree } from "@/components/folder-tree";
import { ViewTabs } from "@/components/view-tabs";
import { TagsRow } from "@/components/tag-pill";
import { AreaBanner } from "@/components/area-convert";
import { BracketBanner } from "@/components/bracket-convert";
import { findAreaWords } from "@/lib/area-tags";
import { hasBracketTitle, tagQuery } from "@/lib/tags";
import { areaContextFor, tagColorsFor } from "@/lib/tag-data";
import { cleanQuery, ENOUGH_EXACT, matchCount, matchKind, tagHits as tagHitsOf } from "@/lib/fuzzy";
import { EmptyState, InfoTip, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { charterOnlyFolderIds } from "@/lib/case-data";
import { buildTree, flattenTree, pathOf, subtreeIds } from "@/lib/folders";
import { flagInfo } from "@/lib/case-flag";
import { flakyCases } from "@/lib/flaky";
import { regressedCases } from "@/lib/regression-data";
import { redirect } from "next/navigation";
import { PRIORITIES, PRIORITY_LABEL, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { projectMembers } from "@/lib/suite-data";
import { hubGroupId, jiraConfigFor, loadUmbrella, platformColor } from "@/lib/umbrella";
import { MoveCasesButton } from "@/components/umbrella-ui";
import { UmbrellaIcon } from "@/components/umbrella-nav";
import type { ResultStatus } from "@prisma/client";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const p = await db.project.findUnique({ where: { key: key.toUpperCase() }, select: { hubOf: { select: { id: true } } } });
  return { title: p?.hubOf ? "Case library" : "Test cases" };
}

const PAGE_SIZE = 100;

type Search = { folder?: string; q?: string; tag?: string; priority?: string; type?: string; runs?: string; flagged?: string; persona?: string; archived?: string; page?: string; platform?: string };

export default async function CasesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  // An umbrella's hub is its Case library: every test cycle under it runs these cases.
  const umbrellaId = await hubGroupId(project.id);
  const u = umbrellaId ? await loadUmbrella(umbrellaId, user) : null;
  const parent = !u && project.groupId ? await db.projectGroup.findUnique({ where: { id: project.groupId }, select: { name: true, hub: { select: { key: true } } } }) : null;
  const platform = u?.platforms.find((p) => p.name.toLowerCase() === sp.platform?.toLowerCase());

  const allFolders = await db.folder.findMany({ where: { projectId: project.id }, select: { id: true, parentId: true, name: true } });
  // Charter-only folders (like Bug bashes) belong on the Charters page (ver_94).
  const charterOnly = await charterOnlyFolderIds(project.id, allFolders);
  const folders = allFolders.filter((f) => !charterOnly.has(f.id));
  const tree = buildTree(folders);
  const counts = await db.testCase.groupBy({ by: ["folderId"], where: { projectId: project.id, archived: false, type: { not: "EXPLORATORY" } }, _count: true });
  const countByFolder = Object.fromEntries(counts.map((c) => [c.folderId ?? "unfiled", c._count]));
  // Who runs each case (ver_95): automation runs Automated cases and any case linked to a test.
  const byAutomation: Prisma.TestCaseWhereInput = { OR: [{ type: "AUTOMATED" }, { AND: [{ automationId: { not: null } }, { automationId: { not: "" } }] }] };
  const robotCounts = await db.testCase.groupBy({ by: ["folderId"], where: { projectId: project.id, archived: false, type: { not: "EXPLORATORY" }, ...byAutomation }, _count: true });
  const robotsByFolder = Object.fromEntries(robotCounts.map((c) => [c.folderId ?? "unfiled", c._count]));

  // Charters have their own page since ver_93; the Case library lists cases only.
  const where: Prisma.TestCaseWhereInput = { projectId: project.id, archived: sp.archived === "1", type: { not: "EXPLORATORY" } };
  const folder = sp.folder && sp.folder !== "unfiled" ? folders.find((f) => f.id === sp.folder) : undefined;
  if (sp.folder === "unfiled") where.folderId = null;
  else if (folder) where.folderId = { in: subtreeIds(folders, folder.id) };

  const q = sp.q?.trim();
  const tagHits = q ? (await db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ${project.id}`).map((r) => r.tag).filter((t) => t.toLowerCase() === tagQuery(q).toLowerCase()) : [];
  if (q) {
    const keyMatch = q.toUpperCase().match(new RegExp(`^(?:${project.key}-)?(\\d+)$`));
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { automationId: { contains: q, mode: "insensitive" } },
      { sourceKey: { equals: q, mode: "insensitive" } },
      { jiraStories: { has: q.toUpperCase() } },
      { preconditions: { contains: q, mode: "insensitive" } },
      ...(keyMatch ? [{ number: Number(keyMatch[1]) }] : []),
      ...(tagHits.length ? [{ tags: { hasSome: tagHits } }] : []),
    ];
  }
  // Tags (ver_96): ?tag=Web,Login shows cases with all of them. A search for "web" or "[WEB]" also finds the tag.
  const pickedTags = (sp.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (pickedTags.length) {
    const all = await db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ${project.id}`;
    const real = pickedTags.map((t) => all.find((x) => x.tag.toLowerCase() === t.toLowerCase())?.tag ?? t);
    where.tags = { hasEvery: real };
  }
  if (sp.priority && (PRIORITIES as string[]).includes(sp.priority)) where.priority = sp.priority as Prisma.TestCaseWhereInput["priority"];
  if (sp.type === "EXPLORATORY") redirect(`/p/${project.key}/charters${sp.persona ? `?persona=${sp.persona}` : ""}`);
  // Old links (?type=) still work; the filter is "Who runs it" since ver_95.
  const runsBy = sp.runs ?? (sp.type === "MANUAL" ? "hand" : sp.type === "AUTOMATED" ? "auto" : "");
  // The count line ignores "Who runs it", so it always shows the whole split.
  const splitWhere: Prisma.TestCaseWhereInput = { ...where };
  if (sp.persona) where.personaId = sp.persona;
  if (sp.flagged === "1") where.flag = { not: null };
  // Everyone sees which cases are flaky; "Flaky only" narrows the list to them.
  const flaky = await flakyCases({ projectId: project.id });
  if (sp.flagged === "flaky") where.id = { in: [...flaky.keys()] };
  // Regression only (ver_93): passed last release on a platform and fails there now.
  if (sp.flagged === "regression") where.id = { in: [...(await regressedCases(project))] };
  if (platform) where.suites = { some: { suiteId: { in: platform.suiteIds } } };
  if (platform) splitWhere.suites = where.suites;
  const handOnly: Prisma.TestCaseWhereInput = { type: { not: "AUTOMATED" }, OR: [{ automationId: null }, { automationId: "" }] };
  const both: Prisma.TestCaseWhereInput = { type: { not: "AUTOMATED" }, automationId: { not: null }, NOT: { automationId: "" } };
  const runsFilter = runsBy === "hand" ? handOnly : runsBy === "auto" ? byAutomation : runsBy === "both" ? both : null;
  if (runsFilter) where.AND = [runsFilter];
  const [splitHand, splitAuto, splitBoth] = await Promise.all([
    db.testCase.count({ where: { AND: [splitWhere, handOnly] } }),
    db.testCase.count({ where: { AND: [splitWhere, { type: "AUTOMATED" }] } }),
    db.testCase.count({ where: { AND: [splitWhere, both] } }),
  ]);

  const page = Math.max(1, Number(sp.page) || 1);
  const caseSelect = {
      id: true,
      number: true,
      title: true,
      priority: true,
      type: true,
      tags: true,
      jiraStories: true,
      folderId: true,
      currentVersion: true,
      automationId: true,
      updatedAt: true,
      flag: true,
      flagNote: true,
      flaggedBy: true,
      flaggedAt: true,
      flagRunNumber: true,
      personaId: true,
      _count: { select: { sharedUsages: true } },
    } satisfies Prisma.TestCaseSelect;
  const [cases, total, tagRows, activeCount, archivedCount] = await Promise.all([
    db.testCase.findMany({
      where,
      orderBy: { number: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: caseSelect,
    }),
    db.testCase.count({ where }),
    db.$queryRaw<{ tag: string; count: number }[]>`SELECT tag, COUNT(*)::int AS count FROM (SELECT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ${project.id} AND archived = false AND type <> 'EXPLORATORY') t GROUP BY tag ORDER BY count DESC, tag`,
    db.testCase.count({ where: { ...where, archived: false } }),
    db.testCase.count({ where: { ...where, archived: true } }),
  ]);
  // Close matches (ver_96): "chekout" finds Checkout cases, under their own label after the exact ones.
  const closeStart = cases.length;
  if (q && page === 1 && total < ENOUGH_EXACT && cleanQuery(q).length > 1) {
    const rest: Prisma.TestCaseWhereInput = { ...where, OR: undefined };
    const exactIds = new Set(cases.map((c) => c.id));
    const cands = await db.testCase.findMany({ where: rest, select: { id: true, title: true, tags: true, folder: { select: { name: true } } }, take: 5000 });
    const found = cands
      .filter((c) => !exactIds.has(c.id) && matchKind(q, `${c.title} ${c.tags.join(" ")} ${c.folder?.name ?? ""}`) === "close")
      .sort((a, b) => Number(!!matchKind(q, `${b.title} ${b.tags.join(" ")}`)) - Number(!!matchKind(q, `${a.title} ${a.tags.join(" ")}`)))
      .slice(0, 20);
    const more = await db.testCase.findMany({ where: { id: { in: found.map((c) => c.id) } }, select: caseSelect });
    const order = new Map(found.map((c, n) => [c.id, n]));
    cases.push(...more.sort((a, b) => order.get(a.id)! - order.get(b.id)!));
  }

  const [members, suites, flaggedCount, personas] = await Promise.all([
    projectMembers(project.id),
    db.testSuite.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.testCase.count({ where: { projectId: project.id, archived: false, flag: { not: null } } }),
    db.persona.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" }, select: { id: true, name: true, emoji: true, archived: true } }),
  ]);
  // Shared library: which platforms run each case, and its last result on each.
  const onPlatforms = new Map<string, { name: string; color: string; status: ResultStatus | null }[]>();
  if (u && u.platforms.length) {
    const ids = cases.map((c) => c.id);
    const [inSuites, last] = await Promise.all([
      db.suiteCase.findMany({ where: { caseId: { in: ids } }, select: { caseId: true, suiteId: true } }),
      db.runEntry.findMany({
        where: { caseId: { in: ids }, status: { notIn: ["UNTESTED", "IN_PROGRESS"] }, run: { projectId: { in: u.projects.map((p) => p.id) } } },
        orderBy: { lastTestedAt: "desc" },
        select: { caseId: true, status: true, run: { select: { project: { select: { platform: true } } } } },
      }),
    ]);
    for (const c of cases) {
      const suites = new Set(inSuites.filter((x) => x.caseId === c.id).map((x) => x.suiteId));
      const results = last.filter((e) => e.caseId === c.id);
      const list = u.platforms
        .map((p) => ({ p, status: results.find((e) => e.run.project.platform.toLowerCase() === p.name.toLowerCase())?.status ?? null }))
        .filter(({ p, status }) => status || p.suiteIds.some((id) => suites.has(id)))
        .map(({ p, status }) => ({ name: p.name, color: platformColor(u.platforms, p.name), status }));
      onPlatforms.set(c.id, list);
    }
  }
  // Each case automation runs: its latest automated result (ver_95).
  const autoIds = cases.filter((c) => c.type === "AUTOMATED" || c.automationId).map((c) => c.id);
  const autoLast = autoIds.length
    ? await db.testResult.findMany({ where: { caseId: { in: autoIds }, run: { automated: true } }, orderBy: { createdAt: "desc" }, distinct: ["caseId"], select: { caseId: true, status: true, createdAt: true } })
    : [];
  const autoOf = new Map(autoLast.map((r) => [r.caseId, { status: r.status, at: r.createdAt.toISOString() }]));
  const sharedBy = u ? u.projects.filter((p) => !p.archivedAt).length : 0;
  // Moving stuck cases is offered only where they live: on this test cycle's Cases left here page (ver_89, not the library header).
  const ownCount = parent?.hub && project.groupId && can(who, "library:move") ? await db.testCase.count({ where: { projectId: project.id, archived: false } }) : 0;
  // A test cycle under an umbrella writes new cases into the umbrella's Case library.
  const newCase = (extra: string) => (parent?.hub ? `/p/${parent.hub.key}/cases/new${extra ? `?${extra}` : ""}` : `/p/${project.key}/cases/new${folder || extra ? `?${[extra, folder && `folder=${folder.id}`].filter(Boolean).join("&")}` : ""}`);
  const folderLabel = (id: string | null) => (id ? pathOf(folders, id).join(" / ") : "");
  const heading = sp.folder === "unfiled" ? "Unfiled" : folder ? folder.name : u ? `${u.group.name} case library` : "All test cases";
  const filtered = Boolean(q || sp.tag || sp.priority || runsBy || sp.flagged || sp.persona || platform);
  const tagColors = await tagColorsFor(project.id);
  const bracketCount = (await db.testCase.findMany({ where: { projectId: project.id, archived: false, title: { startsWith: "[" } }, select: { title: true } })).filter((c) => hasBracketTitle(c.title)).length;
  // Area tags (ver_102): offered once the [brackets] are done, since they follow the platform tag
  // (or, with no platforms set up, the case's one [bracket] tag, ver_105).
  const canTag = sp.archived !== "1" && can(who, "case:edit");
  const areaWords =
    canTag && !bracketCount
      ? findAreaWords(await db.testCase.findMany({ where: { projectId: project.id, archived: false }, select: { title: true, tags: true } }), await areaContextFor(project.id))
      : [];
  const keep = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) u.set(k, v);
    return `?${u.toString()}`;
  };

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-6 lg:flex-row">
      <aside className="lg:w-60 lg:shrink-0">
        <FolderTree
          projectId={project.id}
          projectKey={project.key}
          tree={tree}
          counts={countByFolder}
          robots={robotsByFolder}
          selected={sp.folder ?? null}
          canManage={can(who, "folder:manage")}
          canDelete={can(who, "folder:delete")}
          canMoveCases={can(who, "case:edit")}
        />
      </aside>
      <section className="min-w-0 flex-1">
        <PageHeader
          title={
            u && !folder && sp.folder !== "unfiled" ? (
              <span className="inline-flex items-center gap-2">
                {heading}
                <InfoTip text={`Whole test cases every ${u.group.name} test cycle runs`} />
              </span>
            ) : (
              heading
            )
          }
          subtitle={folder ? pathOf(folders, folder.id).join(" / ") : q ? matchCount(total, cases.length - closeStart) : `${total} ${total === 1 ? "case" : "cases"}`}
          actions={
            <>
              {can(who, "import") && (
                <LinkButton href={`/p/${project.key}/import${folder ? `?folder=${folder.id}` : ""}`}>Import cases</LinkButton>
              )}
              {can(who, "case:edit") && (
                <LinkButton variant="primary" href={newCase("")}>
                  New case
                </LinkButton>
              )}
            </>
          }
        />

        {parent?.hub && (
          <p className="mb-4 flex items-center gap-2.5 rounded-lg bg-accent-50 px-4 py-2.5 text-sm text-slate-700">
            <UmbrellaIcon className="size-4 flex-none text-accent-600" />
            <span>
              This test cycle runs cases from the{" "}
              <Link href={`/p/${parent.hub.key}/cases`} className="font-medium text-accent-700 hover:underline">
                {parent.name} case library
              </Link>
              . Only cases written for this test cycle alone are listed here.
            </span>
          </p>
        )}
        {parent && ownCount > 0 && project.groupId && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent-100 px-4 py-2.5 text-sm text-slate-700">
            <span className="flex-1">
              {ownCount === 1 ? "1 case" : `${ownCount} cases`} only {project.name} can run.
            </span>
            <MoveCasesButton
              groupId={project.groupId}
              umbrella={parent.name}
              projects={[{ id: project.id, name: project.name, cases: ownCount }]}
              label={`↓ Move ${ownCount === 1 ? "this case" : `these ${ownCount} cases`} into the library`}
            />
          </div>
        )}
        {u && (
          <p className="mb-4 flex items-center gap-2.5 rounded-lg bg-accent-50 px-4 py-2.5 text-sm text-slate-700">
            <UmbrellaIcon className="size-4 flex-none text-accent-600" />
            {sharedBy === 1 ? "The 1" : `All ${sharedBy}`} {u.group.name} {sharedBy === 1 ? "test cycle runs" : "test cycles run"} these cases. Edits here show up in the next run each test cycle starts; runs already started keep what they had.
          </p>
        )}
        {canTag && <BracketBanner projectId={project.id} count={bracketCount} colors={tagColors} platforms={!!u?.platforms.length} />}
        {canTag && <AreaBanner projectId={project.id} words={areaWords} colors={tagColors} />}
        <ViewTabs
          label="Case state"
          tabs={[
            { label: "Active", href: keep({ archived: undefined, page: undefined }), count: activeCount, current: sp.archived !== "1" },
            { label: "Archived", href: keep({ archived: "1", page: undefined }), count: archivedCount, current: sp.archived === "1" },
          ]}
        />

        {/* Search and filters only once there's something to search. */}
        {(activeCount + archivedCount > 0 || filtered) && (
        <AutoFilterForm className="mb-4 flex flex-wrap items-center gap-2" role="search">
          {sp.folder && <input type="hidden" name="folder" value={sp.folder} />}
          {sp.archived && <input type="hidden" name="archived" value={sp.archived} />}
          {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
          {platform && <input type="hidden" name="platform" value={platform.name} />}
          <Input name="q" defaultValue={q} placeholder="Search title, ID or automation ID" className="w-full sm:w-72" />
          <Select name="priority" defaultValue={sp.priority ?? ""} className="w-auto" aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          <Select name="runs" defaultValue={runsBy} className="w-auto" aria-label="Who runs it">
            <option value="">Who runs it: Anyone</option>
            <option value="hand">By hand only</option>
            <option value="auto">Automation</option>
            <option value="both">Both</option>
          </Select>
          {personas.length > 0 && (
            <Select name="persona" defaultValue={sp.persona ?? ""} className="w-auto" aria-label="Persona">
              <option value="">Any persona</option>
              {personas
                .filter((p) => !p.archived || p.id === sp.persona)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {p.name}
                  </option>
                ))}
            </Select>
          )}
          <Select key={sp.flagged ?? ""} name="flagged" defaultValue={sp.flagged ?? ""} className="w-auto" aria-label="Flag">
            <option value="">All cases</option>
            <option value="1">Flagged only</option>
            <option value="flaky">Flaky only</option>
            <option value="regression">Regression only</option>
          </Select>
          {filtered && (
            <Link className="text-sm text-slate-500 hover:underline" href={keep({ q: undefined, tag: undefined, priority: undefined, type: undefined, runs: undefined, flagged: undefined, persona: undefined, platform: undefined, page: undefined })}>
              Clear
            </Link>
          )}
          {u?.platforms.map((p) => {
            const on = platform?.name === p.name;
            return (
              <Link
                key={p.name}
                href={keep({ platform: on ? undefined : p.name, page: undefined })}
                aria-current={on ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${on ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700 hover:border-accent-500"}`}
              >
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: platformColor(u.platforms, p.name) }} />
                {p.name}
              </Link>
            );
          })}
          {flaggedCount > 0 && sp.flagged !== "1" && (
            <Link className="inline-flex items-center gap-1 text-sm text-orange-700 hover:underline" href={keep({ flagged: "1", page: undefined })}>
              <FlagIcon className="size-3.5" /> {flaggedCount} flagged
            </Link>
          )}
          {flaky.size > 0 && sp.flagged !== "flaky" && sp.archived !== "1" && (
            <Link
              className="inline-flex items-center gap-1 text-sm text-amber-700 hover:underline"
              href={keep({ flagged: "flaky", page: undefined })}
              title="Cases whose result flipped between Passed and Failed at least twice in their last 10 runs"
            >
              <span aria-hidden>⚡</span> {flaky.size} flaky
            </Link>
          )}
        </AutoFilterForm>
        )}
        {sp.archived !== "1" && (
          <TagsRow
            projectId={project.id}
            tags={tagRows}
            colors={tagColors}
            picked={pickedTags}
            query={keep({ tag: undefined, page: undefined }).slice(1)}
            canEdit={can(who, "case:edit")}
          />
        )}
        {splitHand + splitAuto + splitBoth > 0 && splitAuto + splitBoth > 0 && (
          <p className="mb-2 text-xs text-slate-500" data-testid="who-runs-count">
            {splitHand + splitAuto + splitBoth} cases · ✋ {splitHand} by hand · 🤖 {splitAuto} by automation · {splitBoth} both
          </p>
        )}

        {cases.length === 0 ? (
          !filtered && sp.archived !== "1" && parent?.hub ? (
            // A test cycle in an umbrella: point at the library its runs use, not at starting a second one.
            <EmptyState
              title="No cases of its own"
              action={
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <LinkButton variant="primary" href={`/p/${parent.hub.key}/cases`}>
                    Open the {parent.name} case library
                  </LinkButton>
                  {can(who, "case:edit") && (
                    <Link href={newCase("")} className="text-sm text-accent-700 hover:underline">
                      Write a case for this test cycle only
                    </Link>
                  )}
                </div>
              }
            >
              Its runs use the {parent.name} case library. Write or import cases there so every test cycle can run them.
            </EmptyState>
          ) : (
          <EmptyState
            title={filtered ? "No cases match these filters" : sp.archived === "1" ? "Nothing archived here" : "No test cases here yet"}
            action={
              !filtered && sp.archived !== "1" && can(who, "case:edit") ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <LinkButton variant="primary" href={newCase("")}>
                    Write the first case
                  </LinkButton>
                  {can(who, "import") && <LinkButton href={`/p/${project.key}/import${folder ? `?folder=${folder.id}` : ""}`}>Import cases</LinkButton>}
                </div>
              ) : null
            }
          >
            {!filtered && sp.archived !== "1" && can(who, "import") ? "Or bring existing cases in from a CSV or Excel export." : null}
          </EmptyState>
          )
        ) : (
          <CaseTable
            projectId={project.id}
            projectKey={project.key}
            archivedView={sp.archived === "1"}
            storyLinks={!!(await jiraConfigFor(project.id))}
            canEdit={can(who, "case:edit")}
            canArchive={can(who, "case:archive")}
            run={{ canCreate: can(who, "run:create"), canManageSuites: can(who, "suite:manage"), members, suites, meId: user.id, groupId: u?.group.id, fields: await runFieldsFor(project.id) }}
            folderOptions={flattenTree(tree).map((f) => ({ id: f.id, label: folderLabel(f.id), depth: f.depth }))}
            rows={cases.map((c) => ({
              id: c.id,
              number: c.number,
              title: c.title,
              priority: c.priority,
              type: c.type,
              tags: c.tags,
              version: c.currentVersion,
              usesShared: c._count.sharedUsages > 0,
              stories: c.jiraStories,
              folder: !folder || c.folderId !== folder.id ? folderLabel(c.folderId) : "",
              folderId: c.folderId,
              updatedAt: c.updatedAt.toISOString(),
              flag: flagInfo(c, relativeTime),
              flaky: flaky.get(c.id),
              personaId: c.personaId,
              platforms: onPlatforms.get(c.id),
              auto: c.type === "AUTOMATED" || c.automationId ? (autoOf.get(c.id) ?? { status: null, at: null }) : undefined,
            }))}
            platforms={!!u && u.platforms.length > 0}
            tagColors={tagColors}
            tagHits={q ? [...tagHits, ...tagHitsOf(q, tagRows.map((t) => t.tag))] : []}
            closeStart={cases.length > closeStart ? closeStart : undefined}
            bulk={{ personas: personas.filter((p) => !p.archived), tags: tagRows.map((t) => t.tag) }}
          />
        )}
        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <span className="flex gap-2">
              {page > 1 && <LinkButton size="sm" href={keep({ page: String(page - 1) })}>Previous</LinkButton>}
              {page * PAGE_SIZE < total && <LinkButton size="sm" href={keep({ page: String(page + 1) })}>Next</LinkButton>}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
