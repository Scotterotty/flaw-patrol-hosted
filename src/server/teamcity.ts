"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { open, seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { TeamCityClient, TeamCityError, teamcityBase } from "@/lib/teamcity";
import { BUILD_TYPE_ID } from "@/lib/teamcity-config";
import { attempt, UserError } from "./result";

// TeamCity (ver_228): umbrella Settings → TeamCity, for the Status page. Read-only: Flaw Patrol only
// reads builds. The token is sealed like the Jira token and never goes back to the browser.

async function requireGroup(groupId: string) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: true, teamcity: true } });
  if (!group?.hub) throw new UserError("This isn't an umbrella.");
  const { user } = await requireProjectAction(group.hub.id, "jira:manage");
  return { user, group };
}

async function tc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TeamCityError) throw new UserError(e.message);
    throw e;
  }
}

function savedToken(sealed: string) {
  try {
    return open(sealed);
  } catch {
    throw new UserError("The saved TeamCity token can't be read here (it was saved with a different AUTH_SECRET). Paste it again.");
  }
}

const connSchema = z.object({
  baseUrl: z.string().trim().min(1, "Type the TeamCity server's address, like https://teamcity.example.com.").max(300),
  token: z.string().trim().max(1000).default(""),
});

function connection(group: { teamcity: { baseUrl: string; tokenEncrypted: string } | null }, input: z.input<typeof connSchema>) {
  const d = connSchema.parse(input);
  const base = teamcityBase(d.baseUrl);
  if (!base) throw new UserError("That doesn't look like a web address. Type it like https://teamcity.example.com.");
  // Same server: an empty token box keeps the saved one. A new server needs its own token.
  const token = d.token || (group.teamcity && group.teamcity.baseUrl === base ? savedToken(group.teamcity.tokenEncrypted) : "");
  if (!token) throw new UserError("Paste a TeamCity access token. Make one in TeamCity: your name → Profile → Access Tokens → Create access token.");
  return { base, token, newToken: !!d.token };
}

/** Check the address and token, and list the build configurations the token can see. */
export async function teamcityBuildTypes(groupId: string, input: z.input<typeof connSchema>) {
  return attempt(async () => {
    const { group } = await requireGroup(groupId);
    const { base, token } = connection(group, input);
    const client = new TeamCityClient(base, token);
    const version = await tc(() => client.server());
    const buildTypes = await tc(() => client.buildTypes());
    if (!buildTypes.length) throw new UserError("The token works, but it can't see any build configurations. Use a token from someone who can see the builds you want to watch.");
    return { version, buildTypes, baseUrl: base };
  });
}

const saveSchema = connSchema.extend({
  buildTypes: z
    .array(z.object({ id: z.string().regex(BUILD_TYPE_ID), name: z.string().trim().min(1).max(200), project: z.string().trim().max(200).default("") }))
    .max(50, "Pick up to 50 builds to watch."),
});

/** Save and test: the token must still work. */
export async function saveTeamCity(groupId: string, input: z.input<typeof saveSchema>) {
  return attempt(async () => {
    const { group, user } = await requireGroup(groupId);
    if (group.archivedAt) throw new UserError(`${group.name} is archived. Restore it to change TeamCity.`);
    const d = saveSchema.parse(input);
    if (!d.buildTypes.length) throw new UserError("Pick at least one build to watch.");
    const { base, token, newToken } = connection(group, d);
    await tc(() => new TeamCityClient(base, token).server());
    const fields = { baseUrl: base, buildTypes: d.buildTypes, connectedBy: user.name ?? user.email, ...(newToken || !group.teamcity ? { tokenEncrypted: seal(token) } : {}) };
    await db.teamCityConfig.upsert({ where: { groupId }, create: { groupId, tokenEncrypted: seal(token), ...fields }, update: fields });
    await logActivity({ actor: user, kind: "settings", action: `${group.teamcity ? "Changed" : "Connected"} TeamCity`, group, detail: `${d.buildTypes.length} ${d.buildTypes.length === 1 ? "build" : "builds"} watched${newToken && group.teamcity ? " · Token replaced" : ""}` });
    revalidatePath(`/g/${groupId}`, "layout");
    return { count: d.buildTypes.length };
  });
}

/** Stop watching: the address and token are forgotten. Nothing in TeamCity changes. */
export async function disconnectTeamCity(groupId: string) {
  return attempt(async () => {
    const { group, user } = await requireGroup(groupId);
    await db.teamCityConfig.deleteMany({ where: { groupId } });
    await logActivity({ actor: user, kind: "settings", action: "Disconnected TeamCity", group });
    revalidatePath(`/g/${groupId}`, "layout");
    return {};
  });
}
