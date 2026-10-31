"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { cleanReportQuery } from "@/lib/report-query";
import { isPartId, itemsSchema, newItemId, parseItems, type PartId, type ReportItem } from "@/lib/report-parts";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// Custom reports (ver_101). Anyone who can record results can make one (Viewers read the
// shared ones). Whoever made a report, or anyone allowed to close runs, can change it;
// deleting a shared one stays with whoever made it or an admin, like Saved views.

const nameSchema = z.string().trim().min(1, "Give the report a name").max(80, "Keep the name under 80 characters");

async function editable(projectId: string, id: string) {
  const access = await requireProjectAction(projectId, "run:execute");
  const report = await db.customReport.findFirst({ where: { id, projectId } });
  if (!report) throw new UserError("That report was deleted.");
  if (report.createdById !== access.user.id && (!report.shared || !can(access.who, "run:manage")))
    throw new UserError("Only the person who made this report can change it. Use Make a copy to change your own.");
  return { ...access, report };
}

function refresh() {
  revalidatePath("/p/[key]/reports", "layout");
  revalidatePath("/g/[id]/reports", "layout");
}

/** New report, blank or with its first part. `query`: the filters on the page it came from. */
export async function createCustomReport(projectId: string, input: { name: string; part?: string; query?: string }) {
  return attempt(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const name = nameSchema.parse(input.name);
    const parts: ReportItem[] = input.part && isPartId(input.part) ? [{ k: "part", id: newItemId(), part: input.part }] : [];
    const r = await db.customReport.create({
      data: { projectId, name, query: cleanReportQuery({ ...Object.fromEntries(new URLSearchParams(input.query ?? "")), view: undefined }), parts, createdById: user.id, createdByName: user.name ?? user.email },
    });
    refresh();
    return { id: r.id, name: r.name };
  });
}

/** + Add to report: one more part at the end. */
export async function addPartToReport(projectId: string, id: string, part: string) {
  return attempt(async () => {
    if (!isPartId(part)) throw new UserError("That part can't go in a report.");
    const { report } = await editable(projectId, id);
    const items = parseItems(report.parts);
    if (items.length >= 60) throw new UserError("A report can hold 60 parts and notes. Remove some first.");
    await db.customReport.update({ where: { id }, data: { parts: [...items, { k: "part", id: newItemId(), part: part as PartId }] } });
    refresh();
    return { id, name: report.name };
  });
}

const saveSchema = z.object({
  name: nameSchema.optional(),
  shared: z.boolean().optional(),
  query: z.string().max(2000).optional(),
  items: itemsSchema.optional(),
});

/** The editor saves as you go: name, sharing, the report's filters, and its parts in order. */
export async function saveCustomReport(projectId: string, id: string, input: z.input<typeof saveSchema>) {
  return attempt(async () => {
    const { user, report } = await editable(projectId, id);
    const data = saveSchema.parse(input);
    // Only whoever made it can make a shared report private.
    if (data.shared === false && report.shared && report.createdById !== user.id) throw new UserError("Only the person who made this report can make it private.");
    await db.customReport.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.shared !== undefined && { shared: data.shared }),
        ...(data.query !== undefined && { query: cleanReportQuery({ ...Object.fromEntries(new URLSearchParams(data.query)), view: undefined }) }),
        ...(data.items !== undefined && { parts: data.items }),
      },
    });
    refresh();
    return {};
  });
}

/** Make a copy: yours, private until you share it. */
export async function copyCustomReport(projectId: string, id: string) {
  return attempt(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const src = await db.customReport.findFirst({ where: { id, projectId, OR: [{ shared: true }, { createdById: user.id }] } });
    if (!src) throw new UserError("That report was deleted.");
    const r = await db.customReport.create({
      data: { projectId, name: `${src.name} (copy)`.slice(0, 80), query: src.query, parts: parseItems(src.parts), shared: false, createdById: user.id, createdByName: user.name ?? user.email },
    });
    refresh();
    return { id: r.id };
  });
}

export async function deleteCustomReport(projectId: string, id: string) {
  return attempt(async () => {
    const { user, role } = await requireProjectAction(projectId, "run:execute");
    const r = await db.customReport.findFirst({ where: { id, projectId } });
    if (!r) throw new UserError("That report was already deleted.");
    if (r.createdById !== user.id && !(r.shared && role === "ADMIN")) throw new UserError("Only the person who made this report, or an admin, can delete it.");
    await db.customReport.delete({ where: { id } });
    refresh();
    return {};
  });
}
