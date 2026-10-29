import type { Metadata } from "next";
import { runFieldsFor } from "@/lib/run-fields-server";
import Link from "next/link";
import { badgeOf } from "@/lib/game";
import { Avatar } from "@/components/avatar";
import { PriorityBadge, TagList, TypeBadge } from "@/components/badges";
import { AddToSuite, CaseActions } from "@/components/case-actions";
import { SaveAsTemplate } from "@/components/charters";
import { MoreMenu } from "@/components/more-menu";
import { NewRunButton } from "@/components/new-run";
import { StartRunBox } from "@/components/start-run-box";
import { hubGroupId, jiraConfigFor } from "@/lib/umbrella";
import { projectMembers } from "@/lib/suite-data";
import { CaseFlagButton, FlagIcon } from "@/components/case-flag";
import { CaseHistory } from "@/components/case-history";
import { StepsView } from "@/components/steps-view";
import { CharterView, PersonaChip } from "@/components/charter-view";
import { parseCharter } from "@/lib/charter";
import { Badge, Card, LinkButton } from "@/components/ui";
import { sharedStepDefs } from "@/lib/case-data";
import { flagInfo, flagLabel } from "@/lib/case-flag";
import { flakyCases } from "@/lib/flaky";
import { flakyTip } from "@/lib/run-history";
import { db } from "@/lib/db";
import { pathOf } from "@/lib/folders";
import { caseKey, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { CopyText } from "@/components/copy-text";
import { StoryLinks } from "@/components/story-links";
import { storyInfo } from "@/lib/stories";
import { projectAccess, mySpelling } from "@/lib/session";
import { expandSteps, parseCaseSteps, sharedStepIdsIn } from "@/lib/steps";
import { loadCase } from "./load";

export async function generateMetadata({ params }: { params: Promise<{ key: string; number: string }> }): Promise<Metadata> {
  const { key, number } = await params;
  return { title: `${key.toUpperCase()}-${number}` };
}

export default async function CasePage({ params }: { params: Promise<{ key: string; number: string }> }) {
  const spelling = await mySpelling();
  const { key, number } = await params;
  const { project, user, who } = await projectAccess(key);
  const c = await loadCase(project.id, number);
  const flag = flagInfo(c, relativeTime);
  const isCharter = c.type === "EXPLORATORY";
  // A Case library case runs in one of the umbrella's test cycles, picked in the Start a run box.
  const hubOf = await hubGroupId(project.id);
  const latest = c.versions[0];
  const authorIds = [...new Set(c.versions.map((v) => v.authorId).filter((x): x is string => !!x))];
  const authors = new Map((await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, avatarAt: true, gameEnabled: true, gameFrame: true } })).map((u) => [u.id, u]));
  const items = parseCaseSteps(latest?.steps);
  const defs = await sharedStepDefs(project.id, sharedStepIdsIn(items));
  const steps = expandSteps(items, new Map(defs.map((d) => [d.id, d])));
  const folders = await db.folder.findMany({ where: { projectId: project.id }, select: { id: true, parentId: true, name: true } });
  const folderPath = pathOf(folders, c.folderId);
  const flips = (await flakyCases({ caseIds: [c.id] })).get(c.id);
  const [suites, members] = await Promise.all([
    db.testSuite.findMany({ where: { projectId: project.id, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    projectMembers(project.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Folder" className="mb-2 text-xs text-slate-500">
        {folderPath.length === 0 && "No folder"}
        {folderPath.map((name, i) => (
          <span key={i}>
            {i > 0 && " / "}
            {i === folderPath.length - 1 ? (
              <Link href={`/p/${project.key}/cases?folder=${c.folderId}`} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </span>
        ))}
      </nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-500">{caseKey(project.key, c.number)}</span>
            {c.sourceKey && (
              <span className="text-xs text-slate-500" title="This case's ID in the tool it was imported from">
                was <span className="font-mono">{c.sourceKey}</span>
              </span>
            )}
            {c.archived && <Badge tone="orange">Archived</Badge>}
          </div>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">{c.title}</h1>
          {c.automationId && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span aria-hidden>🤖</span> Automated by <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{c.automationId}</code>
              <CopyText text={c.automationId} label="Copy" />
            </p>
          )}
          {flips && (
            <p className="mt-1.5">
              <span title={flakyTip(flips)} className="inline-flex cursor-help items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                <span aria-hidden>⚡</span> Flaky · flipped {flips} times in its last 10 runs
              </span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={c.priority} />
            <TypeBadge type={c.type} />
            {c.persona && <PersonaChip persona={c.persona} />}
            <TagList tags={c.tags} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(who, "case:flag") && <CaseFlagButton projectId={project.id} projectKey={project.key} caseId={c.id} flag={flag} />}
          {can(who, "suite:manage") && !c.archived && suites.length > 0 && <AddToSuite projectId={project.id} caseId={c.id} suites={suites} />}
          {can(who, "run:create") && !c.archived && hubOf && (
            <StartRunBox
              scope={{ groupId: hubOf }}
              preset={{ what: "cases", caseIds: [c.id] }}
              defaultName={isCharter ? `${c.title} ${new Date().toISOString().slice(0, 10)}` : `${caseKey(project.key, c.number)} ${new Date().toISOString().slice(0, 10)}`}
              label={isCharter ? "▶ Start session…" : "Run this case…"}
              variant={isCharter ? "primary" : "secondary"}
              session={isCharter}
            />
          )}
          {can(who, "run:create") && !c.archived && !hubOf && (
            <NewRunButton
              meId={user.id}
              projectId={project.id}
              projectKey={project.key}
              source={{ kind: "cases", caseIds: [c.id] }}
              defaultName={isCharter ? `${c.title} ${new Date().toISOString().slice(0, 10)}` : `${caseKey(project.key, c.number)} ${new Date().toISOString().slice(0, 10)}`}
              members={members}
              label={isCharter ? "▶ Start session now" : "Run this case"}
              variant={isCharter ? "primary" : "secondary"}
              openRunner={isCharter}
              fields={await runFieldsFor(project.id)}
            />
          )}
          {(can(who, "case:edit") || can(who, "case:archive")) && (
            <MoreMenu>
              <CaseActions
                projectId={project.id}
                projectKey={project.key}
                caseId={c.id}
                archived={c.archived}
                canEdit={can(who, "case:edit")}
                canArchive={can(who, "case:archive")}
              />
            </MoreMenu>
          )}
          {isCharter && can(who, "shared:manage") && !c.archived && <SaveAsTemplate projectId={project.id} title={c.title} charter={parseCharter(latest?.charter)} />}
          {can(who, "case:edit") && !c.archived && (
            <LinkButton variant={isCharter && can(who, "run:create") ? "secondary" : "primary"} href={`/p/${project.key}/cases/${c.number}/edit`}>
              Edit
            </LinkButton>
          )}
        </div>
      </div>

      {flag && (
        <div role="note" className="mb-5 flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <FlagIcon className="mt-0.5 text-orange-500" />
          <div className="min-w-0">
            <p className="font-medium">Flagged: {flagLabel(flag.reason)}</p>
            {flag.note && <p className="mt-0.5 whitespace-pre-wrap wrap-anywhere">{flag.note}</p>}
            <p className="mt-1 text-xs text-orange-800/80">
              {flag.by} {flag.ago}
              {flag.runNumber && (
                <>
                  {" "}
                  in{" "}
                  <Link href={`/p/${project.key}/runs/${flag.runNumber}`} className="underline">
                    run R{flag.runNumber}
                  </Link>
                </>
              )}
              . Clear the flag from the flag button once the case is sorted.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
        <div className="min-w-0 space-y-5">
          {c.preconditions && (
            <Card className="p-4">
              <h2 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{c.type === "EXPLORATORY" ? "Setup" : "Preconditions"}</h2>
              <p className="text-sm whitespace-pre-wrap wrap-anywhere text-slate-800">{c.preconditions}</p>
            </Card>
          )}
          {c.type === "EXPLORATORY" ? (
            <Card className="p-4" role="region" aria-labelledby="mission-heading">
              <h2 id="mission-heading" className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Mission
              </h2>
              <CharterView charter={parseCharter(latest?.charter)} persona={c.persona} />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <StepsView steps={steps} projectKey={project.key} />
            </Card>
          )}
          <CaseHistory caseId={c.id} projectKey={project.key} charter={isCharter} />
        </div>
        <aside className="space-y-5">
          {/* Charters link to requirements too (ver_93), so the Risk board sees them. */}
          {(
            <Card className="p-4">
              <StoryLinks projectId={project.id} caseId={c.id} stories={[...(await storyInfo(project.id, c.jiraStories)).values()]} canEdit={can(who, "case:edit") && !c.archived} jira={!!(await jiraConfigFor(project.id))} />
            </Card>
          )}
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Version history</h2>
            <ol className="space-y-2.5">
              {c.versions.map((v) => (
                <li key={v.id} className="text-sm">
                  <Link href={`/p/${project.key}/cases/${c.number}/versions/${v.version}`} className="font-medium text-slate-800 hover:underline">
                    Version {v.version}
                  </Link>
                  {v.version === c.currentVersion && <span className="ml-1.5 text-xs text-emerald-700">current</span>}
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    {v.authorId && <Avatar person={{ id: v.authorId, name: v.authorName, avatarAt: authors.get(v.authorId)?.avatarAt, frame: badgeOf(authors.get(v.authorId) ?? {}).frame }} size={16} />}
                    {v.authorName || "Unknown"} · <time dateTime={v.createdAt.toISOString()} title={v.createdAt.toISOString()}>{relativeTime(v.createdAt, spelling)}</time>
                  </p>
                  {v.changeNote && <p className="text-xs text-slate-600">{v.changeNote}</p>}
                </li>
              ))}
            </ol>
            <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
              Each run records the version it ran, so editing never changes past results.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
