import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { exportFileName, EXPORT_FORMATS } from "@/lib/case-export";
import { subtreeIds } from "@/lib/folders";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { exportCases, exportFile, EXPORT_MAX } from "@/server/case-export";

const bodySchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  /** ticked or filtered: the ids sent. folder: a folder and everything under it. suite: a test suite's cases. all: the whole library. */
  scope: z.enum(["ids", "folder", "suite", "all"]),
  ids: z.array(z.string().max(40)).max(EXPORT_MAX).optional(),
  folder: z.string().max(40).optional(),
  suiteId: z.string().max(40).optional(),
  archived: z.boolean().optional(),
  timeZone: z.string().max(60).optional(),
});

/** Export cases (ver_190): the picked cases as a file for Excel, Qase, qTest or TestRail. */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { project, who, frame } = await projectAccess(key);
  if (!can(who, "case:export")) return new Response("You can't export cases here. An Admin can turn it on in What can they do.", { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("That export request didn't make sense.", { status: 400 });
  const b = parsed.data;
  const where: Prisma.TestCaseWhereInput = { archived: b.scope === "ids" ? undefined : !!b.archived };
  if (b.scope === "ids") where.id = { in: b.ids ?? [] };
  if (b.scope === "folder" && b.folder) {
    if (b.folder === "unfiled") where.folderId = null;
    else {
      const folders = await db.folder.findMany({ where: { projectId: project.id }, select: { id: true, parentId: true, name: true } });
      where.folderId = { in: subtreeIds(folders, b.folder) };
    }
  }
  let place = frame.hubOf ? ((await db.projectGroup.findUnique({ where: { id: frame.hubOf }, select: { name: true } }))?.name ?? project.name) : project.name;
  if (b.scope === "suite") {
    const suite = await db.testSuite.findFirst({ where: { id: b.suiteId ?? "", projectId: project.id }, select: { name: true, cases: { select: { caseId: true } } } });
    if (!suite) return new Response("That test suite is gone.", { status: 404 });
    where.id = { in: suite.cases.map((c) => c.caseId) };
    place = suite.name;
  }
  const cases = await exportCases(project, where);
  if (!cases.length) return new Response("There are no cases to export.", { status: 404 });
  const format = b.format;
  const { body, type } = await exportFile(format, cases);
  let timeZone: string | undefined;
  try {
    timeZone = b.timeZone ? new Intl.DateTimeFormat("en-US", { timeZone: b.timeZone }).resolvedOptions().timeZone : undefined;
  } catch {}
  const name = exportFileName(place, format, new Date(), timeZone);
  const ascii = name.replace(/[^\x20-\x7e]/g, "-").replace(/"/g, "");
  return new Response(body as BodyInit, {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`, "X-Case-Count": String(cases.length) },
  });
}
