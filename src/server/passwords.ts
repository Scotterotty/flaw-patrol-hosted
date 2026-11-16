"use server";

import { AuthError } from "next-auth";
import { unstable_rethrow } from "next/navigation";
import { mayJoin, passwordSignInOn, signIn } from "@/auth";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { emailInvite, newLink, placeName, RESET_HOURS } from "@/lib/invites";
import { inviteMessage } from "@/lib/invite-message";
import { inviteTitle } from "@/lib/invite-title";
import { mailOn, sendMail } from "@/lib/mail";
import { hashLinkToken, hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { requireProjectAction, requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";

const NO_PASSWORD = "You don't have a password yet. Use the invite link in your email to choose one, or ask an Admin for a new link.";

const SIGN_IN_ERRORS: Record<string, string> = {
  wrong: "That email and password don't match.",
  locked: "Too many wrong passwords. Try again in 15 minutes, or ask an admin for a password link.",
  "not-invited": "That email hasn't been invited yet. Ask an admin to add you.",
  weak: "Pick a stronger password.",
  "sso-only": "Email and password sign-in is off. Use one of the sign-in buttons instead.",
  "no-password": NO_PASSWORD,
};

/** Step one of signing in: does this person sign in with a password, set one up, or neither? */
export async function checkEmail(rawEmail: string): Promise<{ ok: true; next: "password" | "create" } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  const user = await db.user.findUnique({ where: { email }, select: { passwordHash: true, isAdmin: true } });
  if (!user?.isAdmin && !(await passwordSignInOn()) && (await db.user.count()) > 0) return { ok: false, error: SIGN_IN_ERRORS["sso-only"] };
  // An existing account chooses its first password only from an invite or password link.
  if (user) return user.passwordHash ? { ok: true, next: "password" } : { ok: false, error: NO_PASSWORD };
  return (await mayJoin(email)) ? { ok: true, next: "create" } : { ok: false, error: SIGN_IN_ERRORS["not-invited"] };
}

export async function passwordSignIn(input: { email: string; password: string; confirm?: string; name?: string; mode: "password" | "create"; redirectTo: string }) {
  if (input.mode === "create") {
    const problem = passwordProblem(input.password, input.email);
    if (problem) return { ok: false as const, error: problem };
    if (input.password !== input.confirm) return { ok: false as const, error: "The two passwords don't match." };
  }
  try {
    await signIn("password", {
      email: input.email,
      password: input.password,
      name: input.name ?? "",
      mode: input.mode,
      redirectTo: input.redirectTo.startsWith("/") && !input.redirectTo.startsWith("//") ? input.redirectTo : "/",
    });
    return { ok: true as const };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code ?? "wrong";
      return { ok: false as const, error: SIGN_IN_ERRORS[code] ?? SIGN_IN_ERRORS.wrong };
    }
    throw e;
  }
}

/** Change your own password. People who signed in with Google or GitHub and have none can set one. */
export async function changeMyPassword(input: { current: string; next: string; confirm: string }) {
  return attempt(async () => {
    const { id } = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id }, omit: { passwordHash: false } });
    if (user.passwordHash && !(await verifyPassword(input.current, user.passwordHash))) throw new UserError("Your current password isn't right.");
    const problem = passwordProblem(input.next, user.email);
    if (problem) throw new UserError(problem);
    if (input.next !== input.confirm) throw new UserError("The two new passwords don't match.");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.next), passwordSetAt: new Date(), failedLogins: 0, lockedUntil: null } });
    return {};
  });
}

/** The member a project admin may make a link for. Only workspace admins can for another workspace admin. */
async function memberFor(projectId: string, userId: string) {
  const { user: admin, project } = await requireProjectAction(projectId, "members:manage");
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, include: { user: true } });
  if (!member) throw new UserError("They aren't a member of this test cycle.");
  if (member.user.isAdmin && !admin.isAdmin) throw new UserError("Only a workspace admin can reset another workspace admin's password.");
  return { admin, project, member };
}

/**
 * A one-time link a project admin hands a member to set a new password, for a
 * forgotten password or a locked account. Only workspace admins can make one
 * for another workspace admin.
 */
export async function createPasswordLink(projectId: string, userId: string) {
  return attempt(async () => {
    const { admin, project, member } = await memberFor(projectId, userId);
    // Hosted build (backend team review C1): only a workspace admin may see a password link.
    // Anyone else's goes straight to the person's own email, so a test cycle admin can't use
    // it to sign in as a colleague they added.
    if (!admin.isAdmin) {
      if (!(await mailOn())) throw new UserError("Password links go to the person's own email, and email isn't set up. Ask a workspace admin to make one.");
      const link = await newLink(userId, "reset", admin.id);
      await mailPasswordLink(member.user.email, admin, link.url);
      await db.passwordLink.update({ where: { id: link.id }, data: { emailedAt: new Date() } });
      await logActivity({ actor: admin, kind: "signin", action: `Emailed a password link to ${member.user.name ?? member.user.email}`, project });
      return { emailed: member.user.email };
    }
    const link = await newLink(userId, "reset", admin.id);
    await logActivity({ actor: admin, kind: "signin", action: `Made a password link for ${member.user.name ?? member.user.email}`, project });
    return { url: link.url, hours: RESET_HOURS, canEmail: await mailOn() };
  });
}

async function mailPasswordLink(to: string, admin: { name: string | null; email: string }, url: string) {
  try {
    await sendMail({
      to,
      subject: "Set a new Flaw Patrol password",
      lines: [`${admin.name ?? admin.email} made you a link to set a new Flaw Patrol password.`],
      button: { label: "Set a new password", url },
      footer: `It works once and expires in ${RESET_HOURS} hours. Your current password stops working once you use it.`,
    });
  } catch (e) {
    throw new UserError(`Couldn't send it: ${(e as Error).message}`);
  }
}

/** Password link → Email it to them, when Workspace settings → Email is set up. */
export async function emailPasswordLink(projectId: string, userId: string) {
  return attempt(async () => {
    const { admin, project, member } = await memberFor(projectId, userId);
    if (!(await mailOn())) throw new UserError("Email isn't set up. A workspace admin can set it up in Workspace settings → Email.");
    const link = await newLink(userId, "reset", admin.id);
    await mailPasswordLink(member.user.email, admin, link.url);
    await db.passwordLink.update({ where: { id: link.id }, data: { emailedAt: new Date() } });
    await logActivity({ actor: admin, kind: "signin", action: `Emailed a password link to ${member.user.name ?? member.user.email}`, project });
    return { email: member.user.email };
  });
}

/** Resend: email a fresh invite to someone who hasn't signed in yet. */
export async function sendInvite(projectId: string, userId: string) {
  return attempt(async () => {
    const { admin, project, member } = await memberFor(projectId, userId);
    if (!(await mailOn())) throw new UserError("Email isn't set up. A workspace admin can set it up in Workspace settings → Email.");
    try {
      await emailInvite({ projectId, user: member.user, role: member.role, by: admin });
    } catch (e) {
      throw new UserError(`Couldn't send it: ${(e as Error).message} Use Copy invite link instead.`);
    }
    await logActivity({ actor: admin, kind: "people", action: `Emailed an invite to ${member.user.email}`, project });
    return { email: member.user.email };
  });
}

/** Copy invite link: a one-time link to paste into chat when email isn't set up (or didn't arrive). */
export async function copyInviteLink(projectId: string, userId: string) {
  return attempt(async () => {
    const { admin, member } = await memberFor(projectId, userId);
    // An invite is only for someone who hasn't joined yet (review C1): it sets a first password.
    if (member.user.passwordSetAt || member.user.lastLoginAt) throw new UserError("They've already joined, so there's no invite to send. If they forgot their password, use Password link.");
    const link = await newLink(userId, "invite", admin.id);
    const place = await placeName(projectId);
    // Same words as the message after Add.
    return { url: link.url, message: inviteMessage(place, link.url) };
  });
}

/**
 * Where someone lands after accepting an invite (ver_187): the umbrella they were just added to,
 * with a one-time welcome, instead of the Umbrellas list. The newest team they're on wins.
 */
async function inviteLanding(userId: string) {
  const m = await db.projectMember.findFirst({
    where: { userId, project: { archivedAt: null } },
    orderBy: { createdAt: "desc" },
    select: { project: { select: { key: true, hubOf: { select: { id: true } }, group: { select: { id: true, hubProjectId: true } } } } },
  });
  if (!m) return "/";
  const p = m.project;
  const umbrella = p.hubOf?.id ?? (p.group?.hubProjectId ? p.group.id : null);
  return umbrella ? `/g/${umbrella}?welcome=1` : `/p/${p.key}`;
}

/** The invite page: who the link is for, or null when it was used or expired. */
export async function findInviteLink(token: string) {
  const link = await db.passwordLink.findUnique({ where: { tokenHash: hashLinkToken(token) }, include: { user: { select: { id: true, email: true, name: true, passwordSetAt: true } } } });
  if (!link || link.kind !== "invite" || link.usedAt || link.expiresAt < new Date()) return null;
  // Who sent it and where to, so the page reads "Demo Admin invited you to Mobile App".
  const [by, places] = await Promise.all([
    link.createdById ? db.user.findUnique({ where: { id: link.createdById }, select: { name: true, email: true } }) : null,
    db.projectMember.findMany({
      where: { userId: link.user.id, project: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { project: { select: { name: true, group: { select: { name: true } }, hubOf: { select: { name: true } } } } },
    }),
  ]);
  const title = inviteTitle(by?.name || by?.email, places.map((m) => m.project.group?.name ?? m.project.hubOf?.name ?? m.project.name));
  return { email: link.user.email, hasPassword: !!link.user.passwordSetAt, hasName: !!link.user.name?.trim(), title, landing: await inviteLanding(link.user.id) };
}

/**
 * Accept invite: choose a password, give the name the team sees, and sign straight
 * in, instead of typing the password again on the sign-in page. Success redirects home.
 */
export async function acceptInvite(token: string, input: { name: string; next: string; confirm: string }) {
  const link = await db.passwordLink.findUnique({ where: { tokenHash: hashLinkToken(token) }, include: { user: { select: { name: true } } } });
  if (!link || link.kind !== "invite") return { ok: false as const, error: "This link has expired or was already used. Ask an admin for a new one." };
  const name = input.name.trim().slice(0, 80);
  const hasName = !!link.user.name?.trim();
  if (!hasName && !name) return { ok: false as const, error: "Type your name. Your team sees it on runs, bugs and bashes." };
  const res = await spendLink(token, { next: input.next, confirm: input.confirm }, "invite");
  if (!res.ok) return res;
  // Never overwrites a name someone already has.
  if (!hasName) await db.user.update({ where: { id: link.userId }, data: { name } });
  return passwordSignIn({ email: res.email, password: input.next, mode: "password", redirectTo: await inviteLanding(link.userId) });
}

export async function findPasswordLink(token: string) {
  const link = await db.passwordLink.findUnique({ where: { tokenHash: hashLinkToken(token) }, include: { user: { select: { email: true } } } });
  if (!link || link.kind !== "reset" || link.usedAt || link.expiresAt < new Date()) return null;
  return { email: link.user.email };
}

/** The reset page (/reset/[token]): sets a new password with a one-time password link. */
export async function resetWithLink(token: string, input: { next: string; confirm: string }) {
  return spendLink(token, input, "reset");
}

/**
 * A link only does what it was made for (review C1): a password link resets a password, and
 * an invite only sets the first password of someone who has never signed in.
 */
async function spendLink(token: string, input: { next: string; confirm: string }, kind: "reset" | "invite") {
  return attempt(async () => {
    const link = await db.passwordLink.findUnique({ where: { tokenHash: hashLinkToken(token) }, include: { user: true } });
    if (!link || link.kind !== kind || link.usedAt || link.expiresAt < new Date()) throw new UserError("This link has expired or was already used. Ask an admin for a new one.");
    if (kind === "invite" && (link.user.passwordSetAt || link.user.lastLoginAt)) throw new UserError("You've already joined. Sign in instead, or ask an admin for a password link.");
    const problem = passwordProblem(input.next, link.user.email);
    if (problem) throw new UserError(problem);
    if (input.next !== input.confirm) throw new UserError("The two passwords don't match.");
    const used = await db.passwordLink.updateMany({ where: { id: link.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new UserError("This link was already used.");
    await db.user.update({ where: { id: link.userId }, data: { passwordHash: await hashPassword(input.next), passwordSetAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await logActivity({ actor: link.user, kind: "signin", action: link.kind === "invite" ? "Accepted an invite and chose a password" : "Used a password link" });
    return { email: link.user.email };
  });
}
