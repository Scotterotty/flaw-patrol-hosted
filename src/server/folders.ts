"use server";

import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

const nameSchema = z.string().trim().min(1, "Required").max(100).refine((n) => !/[/>\\]/.test(n), "Names can't contain / > or \\");

async function assertUniqueName(projectId: string, parentId: string | null, name: string, exceptId?: string) {
  const clash = await db.folder.findFirst({
    where: { projectId, parentId, name: { equals: name, mode: "insensitive" }, id: exceptId ? { not: exceptId } : undefined },
  });
  if (clash) throw new UserError(`A folder called "${name}" already exists here.`);
}

export async function createFolder(projectId: string, parentId: string | null, rawName: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "folder:manage");
    const name = nameSchema.parse(rawName);
    if (parentId && !(await db.folder.findFirst({ where: { id: parentId, projectId } }))) throw new UserError("Parent folder not found.");
    await assertUniqueName(projectId, parentId, name);
    const folder = await db.folder.create({ data: { projectId, parentId, name } });
    revalidatePath(`/p/${project.key}`, "layout");
    return { id: folder.id };
  });
}

export async function renameFolder(projectId: string, folderId: string, rawName: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "folder:manage");
    const name = nameSchema.parse(rawName);
    const folder = await db.folder.findFirstOrThrow({ where: { id: folderId, projectId } });
    await assertUniqueName(projectId, folder.parentId, name, folderId);
    await db.folder.update({ where: { id: folderId }, data: { name } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** Delete a folder and its subfolders; their cases move up to the folder's parent. */
export async function deleteFolder(projectId: string, folderId: string) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "folder:delete");
    const folder = await db.folder.findFirstOrThrow({ where: { id: folderId, projectId } });
    const all = await db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true } });
    const subtree = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of all) {
        if (f.parentId && subtree.has(f.parentId) && !subtree.has(f.id)) {
          subtree.add(f.id);
          grew = true;
        }
      }
    }
    await db.$transaction([
      db.testCase.updateMany({ where: { folderId: { in: [...subtree] } }, data: { folderId: folder.parentId } }),
      db.folder.delete({ where: { id: folderId } }),
    ]);
    await logActivity({ actor: user, kind: "delete", action: `Deleted folder "${folder.name}"`, project, detail: "Its cases moved up a level" });
    revalidatePath(`/p/${project.key}`, "layout");
    return { parentId: folder.parentId };
  });
}

export async function moveFolder(projectId: string, folderId: string, newParentId: string | null) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "folder:manage");
    const folder = await db.folder.findFirstOrThrow({ where: { id: folderId, projectId } });
    // Refuse to move a folder inside itself.
    let cursor = newParentId;
    while (cursor) {
      if (cursor === folderId) throw new UserError("A folder can't go inside itself.");
      const parent: { parentId: string | null } | null = await db.folder.findFirst({ where: { id: cursor, projectId }, select: { parentId: true } });
      if (!parent) throw new UserError("Folder not found.");
      cursor = parent.parentId;
    }
    await assertUniqueName(projectId, newParentId, folder.name, folderId);
    await db.folder.update({ where: { id: folderId }, data: { parentId: newParentId } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
