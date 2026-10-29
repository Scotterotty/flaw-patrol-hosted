"use server";

import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { newCiToken } from "@/lib/ci-token";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// CI uploads (ver_91): admins make and revoke the tokens a pipeline uses to send results
// to /api/ci/results. Same permission as connecting Jira and GitHub.

async function requireGroup(groupId: string) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: true } });
  if (!group?.hub) throw new UserError("This isn't an umbrella.");
  const { user } = await requireProjectAction(group.hub.id, "jira:manage");
  return { user, group };
}

/** Make a token. It's returned once here and never again. */
export async function createCiToken(groupId: string, name: string) {
  return attempt(async () => {
    const { user, group } = await requireGroup(groupId);
    if (group.archivedAt) throw new UserError("Restore the umbrella first.");
    const label = z.string().trim().max(80).parse(name) || "CI";
    if ((await db.ciToken.count({ where: { groupId } })) >= 20) throw new UserError("An umbrella can have up to 20 tokens. Revoke one you don't use.");
    const { token, hash, last4 } = newCiToken();
    await db.ciToken.create({ data: { groupId, name: label, hash, last4, createdById: user.id, createdBy: user.name ?? user.email } });
    await logActivity({ actor: user, kind: "settings", action: `Made CI upload token "${label}"`, group, detail: `Ends in ${last4}` });
    revalidatePath(`/g/${groupId}/settings`);
    return { token };
  });
}

export async function revokeCiToken(tokenId: string) {
  return attempt(async () => {
    const row = await db.ciToken.findUnique({ where: { id: tokenId } });
    if (!row) return {};
    const { user, group } = await requireGroup(row.groupId);
    await db.ciToken.delete({ where: { id: tokenId } });
    await logActivity({ actor: user, kind: "settings", action: `Revoked CI upload token "${row.name}"`, group, detail: `Ended in ${row.last4}` });
    revalidatePath(`/g/${row.groupId}/settings`);
    return {};
  });
}
