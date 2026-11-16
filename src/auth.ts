import NextAuth, { type NextAuthConfig } from "next-auth";
import { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { buildProviders, COMPANY_PROVIDERS, domainList, emailInDomains, emailTrusted, PROVIDER_NAME, savedProviders, type CompanyProvider } from "@/lib/sign-in-config";
import { adminEmails, ssoOnly } from "@/lib/sso-only";
import { BUILD } from "@/lib/whats-new";

/** Reasons a password sign-in fails, shown on the sign-in form. */
export class SignInProblem extends CredentialsSignin {
  constructor(code: "wrong" | "locked" | "not-invited" | "weak" | "sso-only" | "no-password") {
    super();
    this.code = code;
  }
}

const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

/** Whether email and password sign-in is on for everyone (admins can always use it). */
export async function passwordSignInOn() {
  if (ssoOnly()) return false;
  const ws = await db.workspace.findUnique({ where: { id: 1 }, select: { passwordSignIn: true } }).catch(() => null);
  return ws?.passwordSignIn ?? true;
}

/**
 * Failed tries for the same email within 15 minutes share one log entry
 * ("5 failed password sign-ins"), so a typo or an attack doesn't flood the log.
 */
async function logFailedSignIn(email: string, why: string) {
  try {
    const since = new Date(Date.now() - 15 * 60_000);
    const last = await db.activityEntry.findFirst({
      where: { kind: "signin", actorLabel: email, at: { gte: since }, action: { contains: "ailed password sign-in" } },
      orderBy: { at: "desc" },
    });
    if (last) {
      const n = (parseInt(last.action, 10) || 1) + 1;
      await db.activityEntry.update({ where: { id: last.id }, data: { action: `${n} failed password sign-ins`, at: new Date(), detail: why } });
      return;
    }
    const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
    await logActivity({ actor: user ? { ...user, name: email } : { label: email }, kind: "signin", action: "Failed password sign-in", detail: why });
  } catch (e) {
    console.error("Activity log:", e);
  }
}

// Email and password. Mode "create" makes a brand-new account (the very first
// person, or an allowed email domain). An account that already exists but has no
// password (invited, or signed in with a company button) can't pick one here:
// anyone who knew the email could take it over. They choose it from an invite or
// password link instead (resetWithLink checks the one-time token).
export async function authorizePassword(c: Partial<Record<"email" | "password" | "name" | "mode", unknown>> | undefined) {
  const email = String(c?.email ?? "").trim().toLowerCase();
  const password = String(c?.password ?? "");
  const name = String(c?.name ?? "").trim().slice(0, 100) || null;
  const creating = c?.mode === "create";
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !password) throw new SignInProblem("wrong");
  // Company sign-in only (hosted): no passwords, not even for admins or the very first person.
  if (ssoOnly()) throw new SignInProblem("sso-only");

  const user = await db.user.findUnique({ where: { email }, omit: { passwordHash: false } });
  // With email and password turned off, only workspace admins (and the very first person) may use it.
  if (!user?.isAdmin && !(await passwordSignInOn()) && (await db.user.count()) > 0) throw new SignInProblem("sso-only");
  if (!user) {
    if (!creating) {
      await logFailedSignIn(email, "Not a member");
      throw new SignInProblem("wrong");
    }
    if (passwordProblem(password, email)) throw new SignInProblem("weak");
    if (!(await mayJoin(email))) throw new SignInProblem("not-invited");
    const saved = await db.user.create({
      data: { email, name: name ?? email.split("@")[0], isAdmin: await startsAsAdmin(email), passwordHash: await hashPassword(password), passwordSetAt: new Date(), whatsNewSeen: BUILD },
    });
    await logActivity({ actor: saved, kind: "signin", action: "Chose a password and signed in" });
    return { id: saved.id, email: saved.email, name: saved.name };
  }
  if (!user.passwordHash) {
    await logFailedSignIn(email, creating ? "Tried to choose a first password without an invite or password link" : "No password set yet");
    throw new SignInProblem(creating ? "no-password" : "wrong");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logFailedSignIn(email, "Account locked");
    throw new SignInProblem("locked");
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: failed >= LOCK_AFTER ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
    });
    await logFailedSignIn(email, failed >= LOCK_AFTER ? `Locked for ${LOCK_MINUTES} minutes` : "Wrong password");
    throw new SignInProblem(failed >= LOCK_AFTER ? "locked" : "wrong");
  }
  if (user.failedLogins || user.lockedUntil) await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await logActivity({ actor: user, kind: "signin", action: "Signed in with email and password" });
  return { id: user.id, email: user.email, name: user.name };
}

const passwordProvider = Credentials({
  id: "password",
  name: "Email and password",
  credentials: { email: {}, password: {}, name: {}, mode: {} },
  authorize: authorizePassword,
});

/** The first sign-in uses up any open invite link. */
async function usedInvite(userId: string) {
  await db.passwordLink.updateMany({ where: { userId, kind: "invite", usedAt: null }, data: { usedAt: new Date() } });
}

/** Whether someone without an account may create one: the very first person, or an allowed email domain. */
export async function mayJoin(email: string, providerDomains?: string) {
  // The very first person may join, unless the server names its admins (AUTH_ADMIN_EMAILS).
  if (!adminEmails().size && (await db.user.count()) === 0) return true;
  const ws = providerDomains === undefined ? await db.workspace.findUnique({ where: { id: 1 }, select: { joinDomains: true } }).catch(() => null) : null;
  const domains = [...domainList(process.env.AUTH_ALLOWED_DOMAINS), ...domainList(providerDomains ?? ws?.joinDomains)];
  return emailInDomains(email, domains);
}

/**
 * Sign-in is open to: the first person ever (who becomes workspace admin),
 * anyone already invited (a User row exists), and allowed email domains.
 */
async function admitUser(email: string, name?: string | null, image?: string | null, providerDomains?: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    await usedInvite(existing.id);
    // Admins named on the server (AUTH_ADMIN_EMAILS) are made admin when they sign in.
    const promote = !existing.isAdmin && adminEmails().has(email);
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { name: existing.name ?? name ?? undefined, image: image ?? existing.image, lastLoginAt: new Date(), ...(promote && { isAdmin: true }) },
    });
    if (promote) await logActivity({ actor: updated, kind: "settings", action: "Made a workspace admin", detail: "Named in the server's AUTH_ADMIN_EMAILS" });
    return updated;
  }
  const isAdmin = await startsAsAdmin(email);
  if (!isAdmin && !(await mayJoin(email, providerDomains))) return null;
  return db.user.create({ data: { email, name, image, isAdmin, lastLoginAt: new Date(), whatsNewSeen: BUILD } });
}

/**
 * Whether a new account starts as workspace admin. With AUTH_ADMIN_EMAILS set, only those
 * people (review: "bootstrap the admin from an env var", no first-sign-up race). Otherwise
 * the very first person, as before.
 */
async function startsAsAdmin(email: string) {
  const named = adminEmails();
  if (named.size) return named.has(email);
  return (await db.user.count()) === 0;
}

const isCompany = (id: string): id is CompanyProvider => (COMPANY_PROVIDERS as readonly string[]).includes(id);

// The config is read per request, so a sign-in an admin saves on Workspace settings works at once.
export const { handlers, auth, signIn, signOut } = NextAuth(async (): Promise<NextAuthConfig> => {
  const rows = await savedProviders();
  return {
    providers: [...buildProviders(rows), ...(ssoOnly() ? [] : [passwordProvider])],
    session: { strategy: "jwt" },
    logger: {
      // A cookie from an older copy of the app (different AUTH_SECRET) just means
      // "signed out"; the person signs in again and it's replaced.
      error(error) {
        if (error.name === "JWTSessionError") return;
        // A wrong password is shown on the form; it isn't a server error.
        if ((error as { type?: string }).type === "CredentialsSignin" || error instanceof CredentialsSignin) return;
        console.error(error);
      },
    },
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      async signIn({ user, account, profile }) {
        if (account?.provider === "password") {
          if (user.email) await admitUser(user.email.toLowerCase(), user.name);
          return true;
        }
        const providerId = account?.provider ?? "";
        const email = (user.email ?? "").toLowerCase();
        if (!email) return "/signin?error=NoEmail";
        if (!emailTrusted(providerId, profile as never)) return "/signin?error=Unverified";
        // Read fresh: the cached list may be from before an admin turned this sign-in on.
        const row = isCompany(providerId) ? ((await db.signInProvider.findUnique({ where: { id: providerId } })) ?? undefined) : undefined;
        const testing = !!row && !row.enabled;
        if (testing) {
          // Not turned on yet: only a workspace admin's test sign-in gets through.
          const admin = await db.user.findUnique({ where: { email }, select: { isAdmin: true } });
          if (!admin?.isAdmin) return "/signin?error=NotOn";
        }
        // Domains set for this sign-in; .env-only Google and GitHub use the workspace list.
        const admitted = await admitUser(email, user.name, user.image, row ? row.joinDomains : undefined);
        if (!admitted) return "/signin?error=NotInvited";
        const label = row ? (row.id === "oidc" ? row.label || PROVIDER_NAME.oidc : PROVIDER_NAME[row.id as CompanyProvider]) : providerId === "github" ? "GitHub" : providerId === "microsoft" ? "Microsoft" : "Google";
        if (row) await db.signInProvider.update({ where: { id: row.id }, data: { testedAt: new Date(), testedEmail: email } });
        await logActivity({ actor: admitted, kind: "signin", action: `Signed in with ${label}`, detail: testing ? "Test sign-in" : "" });
        return true;
      },
      async jwt({ token, user }) {
        if (user?.email) {
          const dbUser = await db.user.findUnique({ where: { email: user.email.toLowerCase() } });
          if (dbUser) token.uid = dbUser.id;
        }
        return token;
      },
      session({ session, token }) {
        if (token.uid && session.user) session.user.id = token.uid as string;
        return session;
      },
    },
  };
});
