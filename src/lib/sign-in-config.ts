import "server-only";
import type { SignInProvider } from "@prisma/client";
import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { canOpen, open } from "./crypto";
import { db } from "./db";
import { domainList, emailInDomains, emailTrusted, GUID, type Profile } from "./sign-in-rules";

export { domainList, emailInDomains, emailTrusted, GUID };

// Company sign-ins set from Workspace settings → Sign-in. Each company
// fills in its own Microsoft, Google or single sign-on details, so nothing needs
// a code change or a hosted server. Settings in .env still work and win.

export const COMPANY_PROVIDERS = ["microsoft", "google", "oidc"] as const;
export type CompanyProvider = (typeof COMPANY_PROVIDERS)[number];

export const PROVIDER_NAME: Record<CompanyProvider, string> = {
  microsoft: "Microsoft",
  google: "Google",
  oidc: "Company SSO",
};

/** Microsoft's sign-in host. Tests point it at a pretend server. */
export const microsoftAuthority = () => (process.env.FP_MICROSOFT_AUTHORITY ?? "https://login.microsoftonline.com").replace(/\/+$/, "");


/** Which company sign-ins are set in .env (they can't be changed from the page). */
export function envProviders(): Partial<Record<CompanyProvider | "github", true>> {
  return {
    ...(process.env.AUTH_GOOGLE_ID ? { google: true as const } : {}),
    ...(process.env.AUTH_GITHUB_ID ? { github: true as const } : {}),
  };
}

// Kept on globalThis: a production build bundles this file separately for server actions and the
// sign-in route, so a module variable would let the route keep a stale copy after Save (ver_96 fix).
const shared = globalThis as unknown as { fpSignInCache?: { at: number; rows: SignInProvider[] } | null };

/** Saved company sign-ins, read at most every few seconds. */
export async function savedProviders(): Promise<SignInProvider[]> {
  const cache = shared.fpSignInCache;
  if (cache && Date.now() - cache.at < 5_000) return cache.rows;
  const load = async () => {
    try {
      const rows = await db.signInProvider.findMany();
      shared.fpSignInCache = { at: Date.now(), rows };
      return rows;
    } catch {
      // Before the ver_92 migration has run there is no table yet.
      return [];
    }
  };
  // Every page asks for this before anything else, so after the first time it answers
  // from the last list at once and reads a fresh one in the background. Changes here call
  // forgetSavedProviders, and sign-in itself reads the provider fresh.
  if (cache) {
    cache.at = Date.now();
    void load();
    return cache.rows;
  }
  return load();
}

export function forgetSavedProviders() {
  shared.fpSignInCache = null;
}

/** A saved sign-in has everything it needs to send someone to its sign-in page. */
export function isComplete(p: SignInProvider) {
  if (!p.clientId || !p.secretEncrypted || !canOpen(p.secretEncrypted)) return false;
  if (p.id === "microsoft") return GUID.test(p.tenantId);
  if (p.id === "oidc") return /^https?:\/\//.test(p.issuer);
  return true;
}


/** Turn the saved rows into Auth.js providers. Incomplete or untested rows are still included so an admin can test them. */
export function buildProviders(rows: SignInProvider[]): NextAuthConfig["providers"] {
  const env = envProviders();
  const out: NextAuthConfig["providers"] = [];
  if (env.google) out.push(Google);
  if (env.github) out.push(GitHub);
  for (const p of rows) {
    if (!isComplete(p)) continue;
    if (p.id === "google" && env.google) continue;
    const clientSecret = open(p.secretEncrypted!);
    if (p.id === "microsoft") {
      out.push({
        id: "microsoft",
        name: "Microsoft",
        type: "oidc",
        issuer: `${microsoftAuthority()}/${p.tenantId}/v2.0`,
        clientId: p.clientId,
        clientSecret,
        authorization: { params: { scope: "openid profile email" } },
        // Entra leaves out "email" for some accounts; their sign-in name is their work email.
        profile: (pr: Profile) => ({ id: pr.sub, name: pr.name ?? null, email: (pr.email ?? pr.preferred_username ?? "").toLowerCase() || null, image: null }),
      });
    } else if (p.id === "google") {
      out.push(Google({ clientId: p.clientId, clientSecret }));
    } else if (p.id === "oidc") {
      out.push({
        id: "oidc",
        name: p.label || "Company SSO",
        type: "oidc",
        issuer: p.issuer.replace(/\/+$/, ""),
        clientId: p.clientId,
        clientSecret,
        authorization: { params: { scope: "openid profile email" } },
        profile: (pr: Profile) => ({ id: pr.sub, name: pr.name ?? null, email: pr.email?.toLowerCase() ?? null, image: null, emailVerified: null }),
      });
    }
  }
  return out;
}

/** The buttons on the sign-in page: only sign-ins an admin has tested and turned on (plus .env ones). */
export async function signInButtons(): Promise<{ id: string; name: string }[]> {
  const env = envProviders();
  // Read fresh, so a sign-in an admin just turned on shows at once.
  const rows = await db.signInProvider.findMany().catch(() => []);
  const buttons: { id: string; name: string }[] = [];
  for (const id of COMPANY_PROVIDERS) {
    const row = rows.find((r) => r.id === id);
    if (id === "google" && env.google) buttons.push({ id, name: "Google" });
    else if (row?.enabled && isComplete(row)) buttons.push({ id, name: id === "oidc" ? row.label || "Company SSO" : PROVIDER_NAME[id] });
  }
  if (env.github) buttons.push({ id: "github", name: "GitHub" });
  return buttons;
}
