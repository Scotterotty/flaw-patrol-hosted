import { splitBracketTitle } from "./tags";
import { knownTagNamesFor } from "./tag-data";
import { logActivity } from "@/lib/activity";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { folderFromClass, keysInName, mergeFiles, sameTitle, titleFromTest, type AutoTest } from "@/lib/automation";
import { parseFileSettings } from "@/lib/automation-files";
import { githubRunName } from "@/lib/github-name";
import { attemptOf, keptFor, matchMedia, type Media } from "@/lib/automation-media";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { githubRunOf } from "@/lib/github-runs";
import { libraryProjectIds, OPEN_BUG, umbrellaOf } from "@/lib/umbrella";
import { UserError } from "@/server/result";
import { buildEntries } from "@/server/snapshot";

// The save behind Upload automation results (ver_82), shared by the upload box and,
// since ver_91, the CI endpoint /api/ci/results. Not a server action: callers check access.

export const filesSchema = z
  .array(z.object({ name: z.string().max(300), text: z.string().max(60_000_000) }))
  .min(1, "Drop a results file first.")
  .max(20, "Upload up to 20 files at once.");
export type Files = z.input<typeof filesSchema>;

export function read(files: Files) {
  const list = filesSchema.parse(files);
  try {
    return { list, ...mergeFiles(list) };
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "That file couldn't be read.");
  }
}

export const hashOf = (files: { text: string }[]) => {
  const h = createHash("sha256");
  for (const t of files.map((f) => f.text).sort()) h.update(t).update("\0");
  return h.digest("hex");
};

type LibCase = { id: string; number: number; projectId: string; title: string; automationId: string | null; key: string };

export async function libraryOf(cycleId: string) {
  const cycle = await db.project.findUniqueOrThrow({ where: { id: cycleId } });
  const ids = await libraryProjectIds(cycle);
  const u = await umbrellaOf(cycle);
  const rows = await db.testCase.findMany({
    where: { projectId: { in: ids }, archived: false, type: { not: "EXPLORATORY" } },
    select: { id: true, number: true, projectId: true, title: true, automationId: true, project: { select: { key: true } } },
    orderBy: [{ projectId: "asc" }, { number: "asc" }],
  });
  const cases: LibCase[] = rows.map((r) => ({ id: r.id, number: r.number, projectId: r.projectId, title: r.title, automationId: r.automationId, key: caseKey(r.project.key, r.number) }));
  // New Automated cases go in the umbrella's Case library, or the lone test cycle's own.
  const home = u && !u.isHub ? u.hub : { id: cycle.id, key: cycle.key };
  const keys = [...new Set(rows.map((r) => r.project.key)), cycle.key, home.key];
  return { cycle, cases, home, keys };
}

type Match = { caseId: string; by: "id" | "key" | "link" };

export function matchAll(tests: AutoTest[], cases: LibCase[], keys: string[], links: Record<string, string>) {
  const byAuto = new Map<string, LibCase>();
  for (const c of cases) if (c.automationId) byAuto.set(c.automationId.toLowerCase(), c);
  const byKey = new Map(cases.map((c) => [c.key, c]));
  const byId = new Map(cases.map((c) => [c.id, c]));
  const out = new Map<string, Match>();
  for (const t of tests) {
    const linked = links[t.id] && byId.get(links[t.id]);
    if (linked) {
      out.set(t.id, { caseId: linked.id, by: "link" });
      continue;
    }
    const a = byAuto.get(t.id.toLowerCase());
    if (a) {
      out.set(t.id, { caseId: a.id, by: "id" });
      continue;
    }
    const k = keysInName(`${t.className}.${t.name}`, keys).map((x) => byKey.get(x)).find(Boolean);
    if (k) out.set(t.id, { caseId: k.id, by: "key" });
  }
  return out;
}

export async function duplicateOf(cycleId: string, hash: string) {
  const run = await db.testRun.findFirst({ where: { projectId: cycleId, sourceHash: hash }, orderBy: { createdAt: "desc" }, select: { number: true, createdBy: true, createdAt: true } });
  return run ? { number: run.number, by: run.createdBy, at: run.createdAt.toISOString() } : null;
}

export const saveSchema = z.object({
  name: z.string().trim().max(200).default(""),
  build: z.string().trim().max(200).default(""),
  environment: z.string().trim().max(200).default(""),
  release: z.string().trim().max(200).optional(),
  links: z.record(z.string(), z.string()).default({}),
  makeCases: z.boolean().default(true),
  allowDuplicate: z.boolean().default(false),
  /** Pull from GitHub (ver_85): the connected repo and the workflow run the files came from. */
  github: z.object({ repoId: z.string(), runId: z.string().regex(/^\d+$/) }).optional(),
  /** Screenshots, videos and replays waiting on the server (ver_93), from a zip or a GitHub artifact. */
  stageId: z.string().max(40).optional(),
});

/** A test's own steps as case steps (ver_95). JUnit and NUnit have none. */
const stepItems = (t: AutoTest) => (t.caseSteps ?? []).map((action) => ({ kind: "step", action, expected: "" }));

/** Save each test's screenshots, videos and replays on its result, under the umbrella's rules (ver_93). */
async function saveMedia(cycle: { id: string; groupId: string | null }, tests: AutoTest[], media: Media[], resultOf: Map<string, string>, actorId: string | null) {
  if (!media.length) return 0;
  const group = cycle.groupId ? await db.projectGroup.findUnique({ where: { id: cycle.groupId }, select: { automationFiles: true } }) : null;
  const settings = parseFileSettings(group?.automationFiles);
  const { byTest } = matchMedia(tests, media);
  let saved = 0;
  for (const t of tests) {
    const resultId = resultOf.get(t.id);
    if (!resultId) continue;
    for (const m of keptFor(t, byTest.get(t.id) ?? [], settings)) {
      await db.attachment.create({
        data: { projectId: cycle.id, resultId, fileName: m.path.split("/").pop()!.slice(0, 200), contentType: m.contentType, size: m.bytes.length, data: Buffer.from(m.bytes), kind: m.kind, attempt: attemptOf(m.path), uploadedById: actorId },
      });
      saved++;
    }
  }
  return saved;
}

/** Save the files as one closed, automated run in the test cycle. */
export async function saveAutomationRun(
  project: { id: string; key: string; groupId: string | null },
  files: Files,
  input: z.input<typeof saveSchema>,
  actor: { id: string | null; name: string },
  opts: { linkSameTitle?: boolean; media?: Media[] } = {},
) {
  const cycleId = project.id;
  {
    const meta = saveSchema.parse(input);
    const { list, tests, build: fileBuild, durationSec } = read(files);
    if (!tests.length) throw new UserError("That file has no test results in it.");
    const hash = hashOf(list);
    const dup = await duplicateOf(cycleId, hash);
    if (dup && !meta.allowDuplicate) throw new UserError(`This file is already in Flaw Patrol as Run ${dup.number}.`);
    const { cycle, cases, home, keys } = await libraryOf(cycleId);
    // Pulled from GitHub: the repo must be this umbrella's, and the run's number and link come from GitHub itself.
    let github: { repoId: string; runId: string; number: number; url: string; workflow: string } | null = null;
    if (meta.github) {
      const repo = await db.gitHubRepo.findUnique({ where: { id: meta.github.repoId } });
      if (!repo || repo.groupId !== cycle.groupId) throw new UserError("That GitHub repo isn't connected to this test cycle's umbrella.");
      const run = await githubRunOf(repo, meta.github.runId);
      github = { repoId: repo.id, runId: run.id, number: run.number, url: run.url, workflow: repo.workflowName };
    }
    const library = [...new Set([...cases.map((c) => c.projectId), home.id, cycle.id])];
    const matches = matchAll(tests, cases, keys, meta.links);
    // CI uploads (ver_91) have no one to press Undo, so they take the same-title matches the upload box links.
    if (opts.linkSameTitle)
      for (const t of tests) {
        if (matches.has(t.id)) continue;
        const like = cases.find((x) => sameTitle(x.title, titleFromTest(t.name)));
        if (like) matches.set(t.id, { caseId: like.id, by: "link" });
      }
    const build = meta.build || fileBuild;
    const by = actor.name;
    const now = new Date();

    // Test id → its saved result, for the screenshots, videos and replays.
    const resultOf = new Map<string, string>();
    const number = await db.$transaction(
      async (tx) => {
        // Tests with no case become Automated cases in Automation / <readable class name>.
        const folderIds = new Map<string, string | null>();
        const folderFor = async (testClass: string) => {
          const className = folderFromClass(testClass);
          if (folderIds.has(className)) return folderIds.get(className)!;
          const top = (await tx.folder.findFirst({ where: { projectId: home.id, parentId: null, name: "Automation" } })) ?? (await tx.folder.create({ data: { projectId: home.id, parentId: null, name: "Automation" } }));
          let id: string | null = top.id;
          if (className) {
            const sub = (await tx.folder.findFirst({ where: { projectId: home.id, parentId: top.id, name: className.slice(0, 120) } })) ?? (await tx.folder.create({ data: { projectId: home.id, parentId: top.id, name: className.slice(0, 120) } }));
            id = sub.id;
          }
          folderIds.set(className, id);
          return id;
        };
        if (meta.makeCases) {
          const platformNames = await knownTagNamesFor(home.id);
          for (const t of tests) {
            if (matches.has(t.id)) continue;
            const folderId = await folderFor(t.className);
            const { caseSeq } = await tx.project.update({ where: { id: home.id }, data: { caseSeq: { increment: 1 } } });
            const split = splitBracketTitle(titleFromTest(t.name).slice(0, 500), { platforms: platformNames });
            const title = split.title;
            const folderPath = ["Automation", folderFromClass(t.className)].filter(Boolean).join(" / ");
            const created = await tx.testCase.create({
              data: {
                projectId: home.id,
                number: caseSeq,
                folderId,
                title,
                type: "AUTOMATED",
                automationId: t.id.slice(0, 200),
                tags: split.tags,
                versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "AUTOMATED", automationId: t.id.slice(0, 200), tags: split.tags, folderPath, steps: stepItems(t), authorId: actor.id, authorName: by, changeNote: "Made from automation results" } },
              },
            });
            matches.set(t.id, { caseId: created.id, by: "id" });
          }
        }
        // A match by key or by hand fills in the case's Automation ID, so it's found right away next time.
        for (const [testId, m] of matches) {
          if (m.by === "id") continue;
          await tx.testCase.updateMany({ where: { id: m.caseId, OR: [{ automationId: null }, { automationId: "" }] }, data: { automationId: testId.slice(0, 200) } });
        }
        const ordered = tests.filter((t) => matches.has(t.id));
        if (!ordered.length) throw new UserError("None of the tests matched a case. Tick Make cases for tests with no case, or link them first.");
        // Two tests on one case: the last one's result counts.
        const testOf = new Map<string, AutoTest>();
        for (const t of ordered) testOf.set(matches.get(t.id)!.caseId, t);
        // Every test on one case shares that case's result, so their files land together.
        const testsOf = new Map<string, AutoTest[]>();
        for (const t of ordered) testsOf.set(matches.get(t.id)!.caseId, [...(testsOf.get(matches.get(t.id)!.caseId) ?? []), t]);
        const caseIds = [...new Set(ordered.map((t) => matches.get(t.id)!.caseId))];
        // Automated cases take the test's own steps (ver_95), kept up to date on every upload.
        const autoCases = await tx.testCase.findMany({ where: { id: { in: caseIds }, type: "AUTOMATED" }, select: { id: true, currentVersion: true, versions: { orderBy: { version: "desc" }, take: 1 } } });
        for (const c of autoCases) {
          const t = testOf.get(c.id);
          const v = c.versions[0];
          if (!t?.caseSteps?.length || !v || JSON.stringify(v.steps) === JSON.stringify(stepItems(t))) continue;
          const { id: _id, createdAt: _at, ...was } = v;
          void _id;
          void _at;
          await tx.caseVersion.create({ data: { ...was, charter: was.charter ?? undefined, testData: was.testData ?? undefined, version: v.version + 1, steps: stepItems(t), authorId: actor.id, authorName: by, changeNote: "Steps updated from automation results" } });
          await tx.testCase.update({ where: { id: c.id }, data: { currentVersion: v.version + 1 } });
        }
        const entries = await buildEntries(tx, library, caseIds, null, { wholeCase: true });
        const { runSeq } = await tx.project.update({ where: { id: cycleId }, data: { runSeq: { increment: 1 } } });
        const run = await tx.testRun.create({
          data: {
            projectId: cycleId,
            number: runSeq,
            name: meta.name || (github ? githubRunName(github.workflow, github.number) : ["Automation", cycle.name, build && `build ${build}`].filter(Boolean).join(" · ")),
            build,
            environment: meta.environment,
            release: meta.release ?? cycle.rcName,
            state: "COMPLETED",
            completedAt: now,
            createdById: actor.id,
            createdBy: by,
            automated: true,
            sourceFile: list.map((f) => f.name).join(", ").slice(0, 500),
            ...(github && {
              description: `Pulled from GitHub run #${github.number}`,
              githubRepoId: github.repoId,
              githubRunId: github.runId,
              githubRunNo: github.number,
              githubRunUrl: github.url,
            }),
            sourceHash: hash,
            durationSec,
            entries: { create: entries.map(({ assigneeId, ...e }) => (void assigneeId, e)) },
          },
          include: { entries: { select: { id: true, caseId: true, caseVersion: true, steps: true } } },
        });
        for (const e of run.entries) {
          const t = testOf.get(e.caseId)!;
          const steps = Array.isArray(e.steps) ? e.steps : [];
          const stepStatus = t.status === "FAILED" ? "UNTESTED" : t.status;
          // Retried and passed (ver_93): says so, since that's what makes it flaky.
          const retried = t.status === "PASSED" && t.retried ? `Flaky: failed ${t.retried === 1 ? "once" : `${t.retried} times`}, passed on try ${t.retried + 1}.${t.message ? `\n${t.message}` : ""}` : "";
          const message = retried || (t.crashed ? `Crashed: ${t.message}`.trim() : t.message);
          const result = await tx.testResult.create({
            data: {
              entryId: e.id,
              runId: run.id,
              caseId: e.caseId,
              caseVersion: e.caseVersion,
              status: t.status,
              // Each step's own outcome when the steps came from the test (ver_95).
              stepResults: steps.map((_, i) => ({ status: t.caseSteps?.length === steps.length && t.steps?.length === steps.length ? (t.steps[i].ok ? "PASSED" : "FAILED") : stepStatus, actual: "" })) as Prisma.InputJsonValue,
              comment: message.slice(0, 2000),
              testerName: "Automation",
              imported: true,
              automated: true,
              failureMessage: message,
              stackTrace: t.stack,
              output: t.output,
              durationMs: t.durationMs,
              ...(t.steps?.length && { testSteps: t.steps as Prisma.InputJsonValue }),
              createdAt: now,
            },
          });
          for (const x of testsOf.get(e.caseId) ?? []) resultOf.set(x.id, result.id);
          await tx.runEntry.update({ where: { id: e.id }, data: { status: t.status, lastTestedAt: now } });
          // A bug filed for this test before stays linked while it's open, so it shows instead of asking again.
          if (t.status === "FAILED") {
            const earlier = await tx.defectLink.findMany({
              where: { result: { caseId: e.caseId, automated: true }, defect: { projectId: { in: library }, ...OPEN_BUG } },
              select: { defectId: true },
              distinct: ["defectId"],
            });
            for (const l of earlier) await tx.defectLink.create({ data: { defectId: l.defectId, resultId: result.id, stepIndex: null } });
          }
        }
        return run.number;
      },
      { timeout: 300_000 },
    );
    if (github) await db.gitHubRepo.update({ where: { id: github.repoId }, data: { lastPulledAt: new Date() } });
    if (opts.media?.length) await saveMedia(cycle, tests, opts.media, resultOf, actor.id);
    await logActivity({
      actor: actor.id && !actor.name.startsWith("CI (") ? { id: actor.id, name: actor.name, email: actor.name } : { label: actor.name },
      kind: "run",
      action: github ? `Pulled GitHub run ${github.number} as run R${number}` : `Uploaded automation results as run R${number}`,
      project: { id: cycle.id, name: cycle.name, groupId: cycle.groupId },
    });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath(`/p/${home.key}`, "layout");
    if (project.groupId) revalidatePath(`/g/${project.groupId}`, "layout");
    return { key: project.key, number };
  }
}

