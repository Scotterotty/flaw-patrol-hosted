"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { leaveRequest, readServerUpdate } from "@/lib/server-update-files";
import { updateBlocked } from "@/lib/server-update";
import { requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";

async function requireWorkspaceAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new UserError("Only a workspace admin can do that.");
  return user;
}

/** Workspace settings → Updates → Update now: ask the update helper on the server to update (ver_239). */
export async function requestServerUpdate() {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const view = await readServerUpdate();
    const blocked = updateBlocked(view);
    if (blocked) throw new UserError(blocked);
    if (view.remote && view.remote.behind === 0) throw new UserError("Flaw Patrol is already on the newest code. Check again first if you just pushed.");
    await leaveRequest("update", admin.name ?? admin.email);
    await logActivity({ actor: admin, kind: "settings", action: "Started a Flaw Patrol update", detail: view.remote?.latest ? `To ${view.remote.latest}` : "" });
    revalidatePath("/workspace");
    return {};
  });
}

/** Check for updates: ask the helper to look on GitHub now instead of in a few minutes. */
export async function requestUpdateCheck() {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const view = await readServerUpdate();
    if (view.problem === "none" || view.problem === "folder") throw new UserError(updateBlocked(view)!);
    if (view.status?.state === "updating") throw new UserError("An update is going. It checks again when it's done.");
    if (view.waiting) return {};
    await leaveRequest("check", admin.name ?? admin.email);
    return {};
  });
}
