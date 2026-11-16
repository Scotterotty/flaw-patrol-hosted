import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, passwordSignInOn, signIn } from "@/auth";
import { ssoOnly } from "@/lib/sso-only";
import { LogoBanner } from "@/components/logo";
import { PasswordSignIn } from "@/components/password-sign-in";
import { Button, Card, ErrorText } from "@/components/ui";
import { signInButtons } from "@/lib/sign-in-config";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  NotInvited: "That account hasn't been invited yet. Ask an admin to add your email.",
  AccessDenied: "That account hasn't been invited yet. Ask an admin to add your email.",
  CredentialsSignin: "Enter a valid email address.",
  NotOn: "That sign-in isn't turned on yet. Ask a workspace admin.",
  Unverified: "That account's email address isn't verified, so it can't be matched to a Flaw Patrol account.",
  NoEmail: "That sign-in didn't share an email address, so it can't be matched to a Flaw Patrol account.",
  Configuration: "That sign-in isn't set up correctly. Ask a workspace admin to check Workspace settings → Sign-in.",
  OAuthCallbackError: "That sign-in didn't finish. Please try again.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string; email?: string; admin?: string }> }) {
  const { callbackUrl, error, email, admin } = await searchParams;
  // No page asked for: /start opens your umbrella when you're in only one (Monday audit).
  const redirectTo = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") && callbackUrl !== "/" ? callbackUrl : "/start";
  if ((await auth())?.user) redirect(redirectTo);
  const oauth = await signInButtons();
  // With email and password off, only the company buttons show, plus Admin sign-in for emergencies.
  // Company sign-in only (hosted, AUTH_SSO_ONLY): no password form or Admin sign-in link at all.
  const sso = ssoOnly();
  const showPassword = !sso && (admin === "1" || !oauth.length || (await passwordSignInOn()));

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm overflow-hidden p-6">
        <h1 className="-mx-6 -mt-6 mb-6 bg-[#191d24]">
          <LogoBanner />
        </h1>
        {/* ver_216: a first visit says what this is before asking for an email. */}
        <p className="-mt-2 mb-4 text-center text-sm text-slate-600" data-testid="signin-tagline">
          Write tests, run them together and report bugs, all in one place.
        </p>
        <ErrorText>{error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null}</ErrorText>
        <div className="mt-4 space-y-2">
          {oauth.map((p) => (
            <form
              key={p.id}
              action={async () => {
                "use server";
                await signIn(p.id, { redirectTo });
              }}
            >
              <Button type="submit" className="w-full">
                Sign in with {p.name}
              </Button>
            </form>
          ))}
        </div>
        {sso ? (
          !oauth.length && <p className="mt-2 text-center text-sm text-slate-600">Sign-in isn&apos;t set up on this server yet. Ask IT to add the company sign-in.</p>
        ) : showPassword ? (
          <div className={oauth.length ? "mt-4 border-t border-slate-200 pt-4" : ""}>
            <PasswordSignIn redirectTo={redirectTo} initialEmail={email ?? ""} />
          </div>
        ) : (
          <p className="mt-4 text-center text-xs">
            <Link href={`/signin?admin=1${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`} className="text-slate-500 hover:text-slate-700 hover:underline">
              Admin sign-in
            </Link>
          </p>
        )}
      </Card>
    </main>
  );
}
