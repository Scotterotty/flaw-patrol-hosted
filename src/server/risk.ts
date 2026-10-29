"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { BLANK_CHARTER } from "@/lib/charter";
import { templateById } from "@/lib/charter-templates";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { db } from "@/lib/db";
import { charterMinutes } from "@/lib/risk";
import { riskBoard } from "@/lib/risk-data";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";

// Risk board (ver_93): moving cards, and Plan this release (a run of the riskiest requirements'
// cases, plus a new charter for each risky one that has none).

const nameOf = (u: { name: string | null; email: string }) => u.name ?? u.email;
const level = z.number().int().min(1).max(3);
const issueKey = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, "That isn't a Jira key.");

async function home(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, key: true, groupId: true } });
  const h = await charterHome(p);
  if (h.id !== p.id) throw new UserError("The Risk board lives on the umbrella.");
  return h;
}

/** Move a card on a release's board. Needs risk:move. */
export async function moveRisk(homeId: string, release: string, key: string, likelihood: number, impact: number) {
  return attempt(async () => {
    const { user } = await requireProjectAction(homeId, "risk:move");
    const h = await home(homeId);
    const k = issueKey.parse(key).toUpperCase();
    const rel = z.string().trim().min(1).max(200).parse(release);
    const data = { likelihood: level.parse(likelihood), impact: level.parse(impact), movedById: user.id, movedBy: nameOf(user), movedAt: new Date() };
    await db.riskRating.upsert({ where: { projectId_release_issueKey: { projectId: h.id, release: rel, issueKey: k } }, create: { projectId: h.id, release: rel, issueKey: k, ...data }, update: data });
    revalidatePath(`/p/${h.key}/risk`);
    return {};
  });
}

/** Put a card back where Flaw Patrol guessed. */
export async function resetRisk(homeId: string, release: string, key: string) {
  return attempt(async () => {
    await requireProjectAction(homeId, "risk:move");
    const h = await home(homeId);
    await db.riskRating.deleteMany({ where: { projectId: h.id, release, issueKey: key.toUpperCase() } });
    revalidatePath(`/p/${h.key}/risk`);
    return {};
  });
}

const planSchema = z.object({
  release: z.string().trim().min(1).max(200),
  cycleId: z.string().max(40),
  picks: z
    .array(z.object({ key: issueKey, action: z.enum(["run", "charter", "skip"]), minutes: z.number().int().min(10).max(240).optional(), template: z.string().max(60).nullable().optional() }))
    .max(300),
});
export type PlanInput = z.input<typeof planSchema>;

/**
 * Plan this release: one test run in the picked test cycle with the cases of every requirement
 * marked "run", and a new charter (linked to the requirement) for each one marked "charter".
 */
export async function planRc(homeId: string, input: PlanInput) {
  return attempt(async () => {
    const data = planSchema.parse(input);
    const h = await home(homeId);
    const homeRow = await db.project.findUniqueOrThrow({ where: { id: h.id }, select: { id: true, hubOf: { select: { id: true } } } });
    const cycles = homeRow.hubOf ? await db.project.findMany({ where: { groupId: homeRow.hubOf.id, archivedAt: null, id: { not: h.id } }, select: { id: true } }) : [];
    if (data.cycleId !== h.id && !cycles.some((c) => c.id === data.cycleId)) throw new UserError("Pick a test cycle for the run.");
    const { user, project: cycle } = await requireProjectAction(data.cycleId, "run:create");
    const board = await riskBoard({ homeId: h.id, release: data.release, columns: [] });
    const cardOf = new Map(board.cards.map((c) => [c.key, c]));
    const toRun = data.picks.filter((p) => p.action === "run").flatMap((p) => cardOf.get(p.key)?.caseIds ?? []);
    const toWrite = data.picks.filter((p) => p.action === "charter" && cardOf.has(p.key));
    if (toWrite.length) await requireProjectAction(h.id, "case:edit");
    if (!toRun.length && !toWrite.length) throw new UserError("Nothing to run. Pick Run or New charter for at least one requirement.");
    const team = await teamTemplates(h.id);
    const by = nameOf(user);
    const library = h.id === cycle.id ? [cycle.id] : [cycle.id, h.id];

    const run = await db.$transaction(
      async (tx) => {
        const folder = (await tx.folder.findFirst({ where: { projectId: h.id, parentId: null, name: "Risk board" } })) ?? (await tx.folder.create({ data: { projectId: h.id, parentId: null, name: "Risk board" } }));
        const made: string[] = [];
        for (const p of toWrite) {
          const card = cardOf.get(p.key)!;
          const tpl = p.template ? templateById(p.template, team) : null;
          const title = `${card.key}: ${card.title || "Explore this requirement"}`.slice(0, 300);
          const charter = { ...BLANK_CHARTER, explore: card.title || card.key, with: tpl?.with ?? "", discover: tpl?.discover ?? "what could break before release", minutes: p.minutes ?? charterMinutes(card.level), prompts: tpl?.prompts ?? [] };
          const { caseSeq } = await tx.project.update({ where: { id: h.id }, data: { caseSeq: { increment: 1 } } });
          const c = await tx.testCase.create({
            data: {
              projectId: h.id,
              number: caseSeq,
              folderId: folder.id,
              title,
              type: "EXPLORATORY",
              currentVersion: 1,
              jiraStories: [card.key],
              versions: { create: { version: 1, title, preconditions: "", priority: card.level === "High" ? "HIGH" : "MEDIUM", type: "EXPLORATORY", tags: [], folderPath: "Risk board", steps: [], charter, authorId: user.id, authorName: by, changeNote: `Made by Plan this release for ${data.release}` } },
            },
          });
          made.push(c.id);
        }
        const ids = [...new Set([...toRun, ...made])];
        const entries = await buildEntries(tx, library, ids, null);
        const { runSeq } = await tx.project.update({ where: { id: cycle.id }, data: { runSeq: { increment: 1 } } });
        return tx.testRun.create({
          data: {
            projectId: cycle.id,
            number: runSeq,
            name: `${data.release} · riskiest first`,
            kind: "rc",
            description: `Made from the Risk board: ${toRun.length} ${toRun.length === 1 ? "case" : "cases"} and ${made.length} new ${made.length === 1 ? "charter" : "charters"}.`,
            release: data.release,
            createdById: user.id,
            createdBy: by,
            entries: { create: entries.map(({ assigneeId, ...e }) => (void assigneeId, e)) },
          },
          select: { number: true },
        });
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Planned ${data.release} from the Risk board`, project: { id: cycle.id, name: cycle.name, groupId: cycle.groupId } });
    revalidatePath(`/p/${cycle.key}`, "layout");
    revalidatePath(`/p/${h.key}`, "layout");
    return { href: `/p/${cycle.key}/runs/${run.number}` };
  });
}
